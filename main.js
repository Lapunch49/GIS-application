import MapOL from 'ol/Map.js';
import View from 'ol/View.js';
import {Image as ImageLayer, Tile as TileLayer} from 'ol/layer.js';
import {OSM, Raster, XYZ, Vector} from 'ol/source.js';
import Feature from 'ol/Feature.js';
import Point from 'ol/geom/Point.js';
import Polygon from 'ol/geom/Polygon.js';
import LineString from 'ol/geom/LineString';
import { Stroke, Style, Icon } from 'ol/style';
import VectorLayer from 'ol/layer/Vector.js';
import { createXYZ } from 'ol/tilegrid';
import {Grid, a_star} from './algorithm.js';
import { toLonLat } from 'ol/proj.js';
import GeoJSON from 'ol/format/GeoJSON.js';
import { lineString, lineSplit, intersect} from '@turf/turf';
import osmtogeojson from 'osmtogeojson';

// изображение для иконки маркера
const markerIconURL = 'https://maps.google.com/mapfiles/kml/paddle/red-circle.png';
const markerStyle = new Style({
  image: new Icon({
    anchor: [0.5, 1], // точка привязки иконки (нижняя центральная)
    src: markerIconURL
  })
});

let pointsOnMap = [];
let ZOOM = 15; // уровень масштабирования для алгоритма
let way  = []; // путь на карте (массив точек в формате географических координат)

let kMountain=1; // 1, 9, 17, 25
let kForest = 0; // 0, 1, 2, 3

let startTime = 0;
let endTime = 0;

let topLeft;// верхний левый угол экстента (в проекции карты)
let bottomRight; // нижний правый угол экстента (в проекции карты

let tileWidth; // ширина экстента изображения
let tileHeight; // высота экстента изображения

let width; // ширина окна просмотра (в пикселях)
let height; // длина окна просмотра (в пикселях)

// индекы верхнего левого и правого нижнего тайлов
let xMax;
let xMin;
let yMax;
let yMin;

// их копии(нужны для случаев уменьшения окна поиска)
let xMinConst;
let yMinConst;
let xMaxConst;
let yMaxConst;

// Создаем источник для маркеров
const vectorSourceMarker = new Vector();
const vectorSourceWay = new Vector();
const vectorSourceRectangle = new Vector();

let recVisibleFlag = false; // видимость прям. - окна поиска

/**
 * Generates a shaded relief image given elevation data.  Uses a 3x3
 * neighborhood for determining slope and aspect.
 * @param {Array<ImageData>} inputs Array of input images.
 * @param {Object} data Data added in the "beforeoperations" event.
 * @return {ImageData} Output image.
 */
function shade(inputs, data) {
  const elevationImage = inputs[0];
  const width = elevationImage.width;
  const height = elevationImage.height;
  const elevationData = elevationImage.data;
  const shadeData = new Uint8ClampedArray(elevationData.length);
  const dp = data.resolution * 2;
  const maxX = width - 1;
  const maxY = height - 1;
  const pixel = [0, 0, 0, 0];
  const twoPi = 2 * Math.PI;
  const halfPi = Math.PI / 2;
  const sunEl = (Math.PI * data.sunEl) / 180;
  const sunAz = (Math.PI * data.sunAz) / 180;
  const cosSunEl = Math.cos(sunEl);
  const sinSunEl = Math.sin(sunEl);
  let pixelX,
    pixelY,
    x0,
    x1,
    y0,
    y1,
    offset,
    z0,
    z1,
    dzdx,
    dzdy,
    slope,
    aspect,
    cosIncidence,
    scaled;

  function calculateElevation(pixel) {
    // The method used to extract elevations from the DEM.
    // In this case the format used is Terrarium
    // red * 256 + green + blue / 256 - 32768
    //
    // Other frequently used methods include the Mapbox format
    // (red * 256 * 256 + green * 256 + blue) * 0.1 - 10000
    //
    return pixel[0] * 256 + pixel[1] + pixel[2] / 256 - 32768;
  }
  for (pixelY = 0; pixelY <= maxY; ++pixelY) {
    y0 = pixelY === 0 ? 0 : pixelY - 1;
    y1 = pixelY === maxY ? maxY : pixelY + 1;
    for (pixelX = 0; pixelX <= maxX; ++pixelX) {
      x0 = pixelX === 0 ? 0 : pixelX - 1;
      x1 = pixelX === maxX ? maxX : pixelX + 1;

      // determine elevation for (x0, pixelY)
      offset = (pixelY * width + x0) * 4;
      pixel[0] = elevationData[offset];
      pixel[1] = elevationData[offset + 1];
      pixel[2] = elevationData[offset + 2];
      pixel[3] = elevationData[offset + 3];
      z0 = data.vert * calculateElevation(pixel);

      // determine elevation for (x1, pixelY)
      offset = (pixelY * width + x1) * 4;
      pixel[0] = elevationData[offset];
      pixel[1] = elevationData[offset + 1];
      pixel[2] = elevationData[offset + 2];
      pixel[3] = elevationData[offset + 3];
      z1 = data.vert * calculateElevation(pixel);

      dzdx = (z1 - z0) / dp;

      // determine elevation for (pixelX, y0)
      offset = (y0 * width + pixelX) * 4;
      pixel[0] = elevationData[offset];
      pixel[1] = elevationData[offset + 1];
      pixel[2] = elevationData[offset + 2];
      pixel[3] = elevationData[offset + 3];
      z0 = data.vert * calculateElevation(pixel);

      // determine elevation for (pixelX, y1)
      offset = (y1 * width + pixelX) * 4;
      pixel[0] = elevationData[offset];
      pixel[1] = elevationData[offset + 1];
      pixel[2] = elevationData[offset + 2];
      pixel[3] = elevationData[offset + 3];
      z1 = data.vert * calculateElevation(pixel);

      dzdy = (z1 - z0) / dp;

      slope = Math.atan(Math.sqrt(dzdx * dzdx + dzdy * dzdy));

      aspect = Math.atan2(dzdy, -dzdx);
      if (aspect < 0) {
        aspect = halfPi - aspect;
      } else if (aspect > halfPi) {
        aspect = twoPi - aspect + halfPi;
      } else {
        aspect = halfPi - aspect;
      }

      cosIncidence =
        sinSunEl * Math.cos(slope) +
        cosSunEl * Math.sin(slope) * Math.cos(sunAz - aspect);

      offset = (pixelY * width + pixelX) * 4;
      scaled = 255 * cosIncidence;
      shadeData[offset] = scaled;
      shadeData[offset + 1] = scaled;
      shadeData[offset + 2] = scaled;
      shadeData[offset + 3] = elevationData[offset + 3];
    }
  }

  return {data: shadeData, width: width, height: height};
}

function updateTileSizes(){
  const TILE_SIZE = 256;

  // Создаем TileGrid для уровня масштабирования
  const tileGrid = createXYZ({ maxZoom: ZOOM });

   // Размер итогового изображения
   width = (xMax - xMin + 1) * TILE_SIZE;
   height = (yMax - yMin + 1) * TILE_SIZE;
 
   console.log(width, height);
 
   // Получаем экстент тайлов topLeft и bottomRight
   const extentMin = tileGrid.getTileCoordExtent([ZOOM, xMin, yMin]);
   const extentMax = tileGrid.getTileCoordExtent([ZOOM, xMax, yMax]);
 
   // Верхний левый угол экстента (в проекции карты)
   topLeft = [extentMin[0], extentMin[3]];
   // Нижний правый угол экстента (в проекции карты)
   bottomRight = [extentMax[2], extentMax[1]];
 
   //Ширина и высота экстента изображения
   tileWidth = extentMax[2]-extentMin[0];
   tileHeight = extentMin[3]-extentMax[1];
   console.log([toLonLat(topLeft),toLonLat(bottomRight)]);
}

// рассчитываем новые topLeft, bottomRight, tileWidth, tileHeight, width, height
// учитывая все точки-маркеры и уровень zoom
function updateTileIndexes(){

  // Создаем TileGrid для уровня масштабирования
  const tileGrid = createXYZ({ maxZoom: ZOOM });

  // Получаем индексы тайлов, в которых оказались наши точки
  xMax = 0;
  xMin = 32768; // максимально возможный +1 индекс тайла для zoom=15
  yMax = 0;
  yMin = 32768;
  pointsOnMap.forEach((point)=>{
    // Получаем индексы тайла, в котором оказалась наша точка
    let [tileIndexX,tileIndexY] = tileGrid.getTileCoordForCoordAndZ(point, ZOOM).slice(1);
    // Обновляем мин. и макс. индексы - граничные индексы тайлов(верхнего левого и правого нижнего), которые будем скачивать
    xMax = Math.max(xMax,tileIndexX);
    xMin = Math.min(xMin,tileIndexX);
    yMax = Math.max(yMax,tileIndexY);
    yMin = Math.min(yMin,tileIndexY);
  });

  xMinConst = xMin;
  yMinConst = yMin;
  xMaxConst = xMax;
  yMaxConst = yMax;

  updateTileSizes();
}

function updateTileIndexes_plus(){

  const MaxForZoom = Math.pow(2,ZOOM); // максимально возможный +1 индекс тайла для zoom

  // обновляем размеры, если это возможно
  if (xMin>=1)
    xMin -=1;
  if (yMin>=1)
    yMin -=1;
  if (xMax<=MaxForZoom-2){
    xMax+=1;
  }
  if (yMax<=MaxForZoom-2){
    yMax+=1;
  }
  
  updateTileSizes();
}

function updateTileIndexes_minus(){
  // обновляем размеры, если это возможно
  if (xMin<xMinConst)
    xMin +=1;
  if (yMin<yMinConst)
    yMin +=1;
  if (xMax>xMaxConst){
    xMax -=1;
  }
  if (yMax>yMaxConst){
    yMax -=1;
  }
  
  updateTileSizes();
}

// Вычисляем положение точек внутри изображения (из координат в пиксели)
function findPixelsCoords(coordinatesAll,topLeftL, tileWidthL, tileHeightL, widthL, heightL){ // здесь tileWidth, tileHeight - размеры сторон тайлов
  let pixelsAll =[];
  for (const [x, y] of coordinatesAll){
    const pixelX = Math.floor((x - topLeftL[0]) / tileWidthL * widthL);
    const pixelY = Math.floor((topLeftL[1] - y) / tileHeightL * heightL);
    pixelsAll.push([pixelX,pixelY])
  } 
  return pixelsAll;
}

// Вычисляем положение точек внутри изображения (из пикселей в координаты)
function findCoordsPixels(pixelsAll,topLeftL, pixelLen){
  let coordinatesAll =[];
  pixelsAll.forEach((pixel)=>{
      let x = pixel.x*pixelLen+topLeftL[0];
      let y = topLeftL[1]-pixel.y*pixelLen;
      coordinatesAll.push([x,y]);
    });
  return coordinatesAll;
}

async function makeImage(){
  const startTimeDataPreprocess = performance.now();
  const TILE_SIZE = 256;
  const sourceURL = 'https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png';

  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d');

  canvas.width = width;
  canvas.height = height;

  const loadTile = async (x, y) => {
      const url = sourceURL.replace('{z}', ZOOM).replace('{x}', x).replace('{y}', y);
      const response = await fetch(url);
      const blob = await response.blob();
      const img = new Image();
      const imgLoadPromise = new Promise(resolve => {
          img.onload = () => resolve(img);
      });
      img.src = URL.createObjectURL(blob);
      return imgLoadPromise;
  };

  const loadAllTiles = async () => {
      for (let x = xMin; x <= xMax; x++) {
          for (let y = yMin; y <= yMax; y++) {
              const img = await loadTile(x, y);
              const posX = (x - xMin) * TILE_SIZE;
              const posY = (y - yMin) * TILE_SIZE;
              ctx.drawImage(img, posX, posY, TILE_SIZE, TILE_SIZE);
          }
      }
  };

  const loadDEM = loadAllTiles();

  const topLeftLonLat = toLonLat(topLeft);
  const bottomRightLonLat = toLonLat(bottomRight);

  const waterTags = [{ key: 'natural', value: 'water' }, {key: 'natural', value: 'wetland' }];
  const forestTags = [{ key: 'landuse', value: 'forest' }, { key: 'natural', value: 'wood' }];
  const waterwayTags = [{ value:'waterway'}];
  const bridgeTags = [{value:'bridge'}];
  const buildingTags = [{value:'building'}];
  const barrierTags = [{value:'barrier'}];
  
  let obstacleMatrix=[];
  let forestMatrix=[];
  let waterwayMatrix=[];
  let bridgeMatrix = [];
  let buildingMatrix = [];
  let barrierMatrix = [];

  const bbox = `${bottomRightLonLat[1]},${topLeftLonLat[0]},${topLeftLonLat[1]},${bottomRightLonLat[0]}`;

  // данные о воде(водные объекты и болота)
  // try{
    const waterData = await getLanduseData(bbox, waterTags);
    obstacleMatrix = createMatrixForPolygon(topLeftLonLat, bottomRightLonLat, waterData);

  // данные о речных путях
  const waterwayData = await getWaysData(bbox, waterwayTags);
  if (waterwayData.elements.length >=1 ){
    waterwayMatrix = createMatrixForWay(topLeftLonLat, bottomRightLonLat, waterwayData);
    // объединяем инфу обо всех водных объектах в obstacleMatrix
    for (let i=0; i<height; i++){
      for (let j=0; j<width; j++){
        obstacleMatrix[i][j] = obstacleMatrix[i][j] || waterwayMatrix[i][j];
      }
    }
  }

  // данные о зданиях
  const buildingData = await getWaysData(bbox, buildingTags);
  if (buildingData.elements.length >=1 ){
    buildingMatrix = createMatrixForPolygon(topLeftLonLat, bottomRightLonLat, buildingData);
    // объединяем инфу обо всех водных объектах в obstacleMatrix
    for (let i=0; i<height; i++){
      for (let j=0; j<width; j++){
        obstacleMatrix[i][j] = obstacleMatrix[i][j] || buildingMatrix[i][j];
      }
    }
  }

  // данные о заборах
  const barrierData = await getWaysData(bbox, barrierTags);
  if (barrierData.elements.length >=1 ){
    barrierMatrix = createMatrixForWay(topLeftLonLat, bottomRightLonLat, barrierData);
    // объединяем инфу о водных объектах и мостах в obstacleMatrix
    for (let i=0; i<height; i++){
      for (let j=0; j<width; j++){
        obstacleMatrix[i][j] = obstacleMatrix[i][j] || barrierMatrix[i][j];
      }
    }
  }

  // данные о мостах
  const bridgeData = await getWaysData(bbox, bridgeTags);
  if (bridgeData.elements.length >=1 ){
    bridgeMatrix = createMatrixForWay(topLeftLonLat, bottomRightLonLat, bridgeData);
    // объединяем инфу о водных объектах и мостах в obstacleMatrix
    for (let i=0; i<height; i++){
      for (let j=0; j<width; j++){
        // if (bridgeMatrix[i][j] == true){
        //   obstacleMatrix[i][j] = false;
        // }
        obstacleMatrix[i][j] = obstacleMatrix[i][j] ^ bridgeMatrix[i][j];
      }
    }
  }

  // данные о лесах
  const forestData = await getLanduseData(bbox, forestTags);
  forestMatrix = createMatrixForPolygon(topLeftLonLat, bottomRightLonLat, forestData);
  //console.log('Forest Query:');

  
  //waterMatrix = await createMatrixOfWater(topLeftLonLat, bottomRightLonLat);

  // Вычисляем координаты наших точек на изображении
  const pointsArrPixels = findPixelsCoords(pointsOnMap,topLeft,tileWidth,tileHeight, width, height);

  let pathOnMap = [];
  const matrix = [];

  await loadDEM.then(() => {
      // Получить данные изображения в формате PNG
      //const dataURL = canvas.toDataURL('image/png');

      // Создать матрицу = изображению
      const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
      const data = imageData.data;

      for (let y = 0; y < canvas.height; y++) {
        const row = [];
        for (let x = 0; x < canvas.width; x++) {
            const index = (y * canvas.width + x) * 4;
            const r = data[index];
            const g = data[index + 1];
            const b = data[index + 2];
            const value = r * 256 + g + b / 256 - 32768;
            row.push(value);
        }
        matrix.push(row);
      }
         
      // // Либо скачать изображение
      // const link = document.createElement('a');
      // link.href = dataURL;
      // link.download = 'map.png';
      // link.click();

  });

  //loadAllTiles().then();
  

  // создадим сетки для каждой части пути(для каждой пары начала и конца пути)
  let grids = []; 
  for (let i=0; i<pointsArrPixels.length-1; i++){
    // создаем массив(сетку), каждая ячейка которого Cell содержит инф. о x,y,heigth пикселя, а также gScore, fScore, isAbstacle и др.
    // также для каждой сетки известны свои координаты начала и конца пути(для каждой пары точек)
    let grid=new Grid(width, height, pointsArrPixels[i], pointsArrPixels[i+1], matrix, obstacleMatrix, forestMatrix );
    grids.push(grid);
  }
  // Вычисление и вывод времени выполнения
  const endTimeDataPreprocess = performance.now();
  const timeDataPreprocess = endTimeDataPreprocess - startTimeDataPreprocess;
  console.log(`Размер окна поиска: ${width}x${height}`);
  console.log(`Время предобработки данных: ${timeDataPreprocess.toFixed(2)} миллисекунд`);
  // для каждой пары точек находим мин. путь
  // если путь для какого-то участка не найден, останавливаемся и выводим сообщение об этом
  let pathTotal =[];
  let flag=false;
  const startTimeAlg = performance.now();
  for (let i=0; i<grids.length; i++){
    let path = a_star(grids[i], ZOOM, kMountain, kForest);
    if (path.length == 0){
      flag=true;
      break;
    } else{
      pathTotal.push(path);
    }
  }
  const endTimeAlg = performance.now();

  // Вычисление и вывод времени выполнения
  const timeAlg = endTimeAlg - startTimeAlg;
  console.log(`Время работы алгоритма: ${timeAlg.toFixed(2)} миллисекунд`);

  // если все пути были найдены
  if (!flag){
    let pathOnMapTotal=[];
    // переводим координаты пикселей в координаты на карте(EPSG:4326), изначально перевернув их(т.к. алгоритм формирует пути с конца)
    for (let i=0; i<grids.length; i++){
      let pathOnMapPart = findCoordsPixels(pathTotal[i].reverse(),topLeft,grids[i].dictZoomPixelLen.get(ZOOM));
      pathOnMapTotal.push(pathOnMapPart);
    }
    // соединяем все пути и точки вместе
    for (let i=0; i<pathOnMapTotal.length; i++){
      pathOnMap.push(pointsOnMap[i]);
      pathOnMap.push(...pathOnMapTotal[i]);
    }
    // соединяем с посл. точкой
    pathOnMap.push(pointsOnMap[pointsOnMap.length-1]);

    //console.log(pathOnMap);
  }
  // если какой-то путь не был найден
  else{
    if (pointsArrPixels.length == 2){
      alert('Не удалось найти путь, попробуйте увеличить размер окна поиска');
    }
    else{
      alert('Не удалось найти маршрут между некоторыми точками');
    }
  }

  // возвращаем путь в координатах проекции карты(EPSG:4326)
  return pathOnMap;
// } catch{
//   alert("У вас проблемы с интернет-соединением!");
// }
}

const elevation = new XYZ({
  url: 'https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png',
  crossOrigin: 'anonymous',
  maxZoom: 15,  
  attributions:
    '<a href="https://github.com/tilezen/joerd/blob/master/docs/attribution.md" target="_blank">Data sources and attribution</a>',
});


const raster = new Raster({
  sources: [elevation],
  operationType: 'image',
  operation: shade,
});


const map = new MapOL({
  target: 'map',
  layers: [
    new TileLayer({
      source: new OSM(),
    }),
    new ImageLayer({
      opacity: 0.3,
      source: raster,
    }),
  ],
  view: new View({
    center: [6228733.745091898, 7309389.260521347],
    zoom: 13,
  }),
});

// Создаем слой для маркеров и добавляем его на карту
const vectorLayerMarker = new VectorLayer({
  source: vectorSourceMarker
});
map.addLayer(vectorLayerMarker);

// Создаем слой для пути и добавляем его на карту
const vectorLayerWay = new VectorLayer({
  source: vectorSourceWay,
  style: new Style({
    stroke: new Stroke({
        color: '#ff0000',
        width: 3
    })
})
});
map.addLayer(vectorLayerWay);

// Создаем слой для прямойгольник - окна поиска - и добавляем его на карту
const vectorLayerRectangle = new VectorLayer({
  source: vectorSourceRectangle
});
map.addLayer(vectorLayerRectangle);

const controlIds = ['vert', 'sunEl', 'sunAz'];
const controls = {};
controlIds.forEach(function (id) {
  const control = document.getElementById(id);
  control.addEventListener('input', function () {
    raster.changed();
  });
  controls[id] = control;
});

raster.on('beforeoperations', function (event) {
  // the event.data object will be passed to operations
  const data = event.data;
  data.resolution = event.resolution;
  for (const id in controls) {
    data[id] = Number(controls[id].value);
  }
});

// связываем слайдеры и значения коэффициентов в коде
var zoomSlider = document.getElementById("zoomSlider");
// Update the current slider value (each time you drag the slider handle)
zoomSlider.oninput = function() {
  ZOOM = parseInt(this.value);
  updateTileIndexes();
  if (pointsOnMap.length >= 2 && recVisibleFlag){
  createRectangle();
}
}

var mountainSlider = document.getElementById("mountainSlider");
mountainSlider.oninput = function() {
  kMountain = parseInt(this.value);
}

var forestSlider = document.getElementById("forestSlider");
forestSlider.oninput = function() {
  kForest = parseInt(this.value);
}

function createRectangle(){
  // Создание геометрии прямоугольника
  const rectangleCoords = [
    [topLeft[0], topLeft[1]],
    [bottomRight[0], topLeft[1]],
    [bottomRight[0], bottomRight[1]],
    [topLeft[0], bottomRight[1]],
    [topLeft[0], topLeft[1]] // Замыкаем прямоугольник
  ];

  // Создание объекта Feature с геометрией типа Polygon
  const rectangleFeature = new Feature({
    geometry: new Polygon([rectangleCoords])
  });

  // Изменение векторного источника и слоя
  vectorSourceRectangle.clear();
  vectorSourceRectangle.addFeature(rectangleFeature);

  //map.render();
  // map.updateSize();
}

map.on('click', async function(event) {
  const coordinates = event.coordinate; // Получить координаты клика

  // Сохранить координаты в массиве
  pointsOnMap.push(coordinates);
  updateTileIndexes();
  if (recVisibleFlag == true){
    createRectangle();
  }

  // Создать метку на карте
  const marker = new Feature({
    geometry: new Point(coordinates)
  });
  // Применить стиль к маркеру
  marker.setStyle(markerStyle);

  vectorSourceMarker.addFeature(marker);

  console.log(pointsOnMap);
});

// Функция для очистки слоя маркеров
function clearMarkers() {
  vectorSourceMarker.clear();
  pointsOnMap = [];
  console.log("Координаты удалены");
}

// Функция для очистки слоя пути 
function clearWay() {
  vectorSourceWay.clear();
  way = [];
  console.log("Путь удален");
}

// Функция для очистки слоя прямоугольника
function clearRec() {
  vectorSourceRectangle.clear();
  recVisibleFlag = false;
}

document.getElementById('find-way').addEventListener('click', async function() {
  
  // // Очищаем ссылку и объект URL после завершения скачивания
  // window.URL.revokeObjectURL(url);
  // document.body.removeChild(a);
  // try{
    // стираем путь, если он уж был
    clearWay();
    // проверка на слишком большую отдаленность точек
    if (height*width >= 2048*1792){
      alert('Слишком большое окно поиска, попробуйте уменьшить уровень zoom');
    } 
    else{
      if (pointsOnMap.length >= 2){
        startTime = performance.now();
        way = await makeImage();
        endTime = performance.now();
        console.log("Кол-во точек маршрута:", way.length);
        // Вычисление и вывод времени выполнения
        const timeAll = endTime - startTime;
        //console.log(`Время предобработки: ${(timeAll-timeAlg).toFixed(2)} миллисекунд`);
        console.log(`Общее время выполнения: ${timeAll.toFixed(2)} миллисекунд`);
        
        // вывод маршрута
        let pathFeature = new Feature({
          geometry: new LineString(way),
          name: 'Route'
        });

        // добавляем линию в слой векторных объектов
        vectorSourceWay.addFeature(pathFeature);

        // добавляем прямоугольгник
        createRectangle();
        vectorLayerRectangle.setVisible(true);
        recVisibleFlag = true;
      }else{
        alert("Введите не менее 2х точек!");
      }
    }
    //} 
    // catch {
    //   alert('Произошла ошибка при попытке запустить алгоритм');
    // }
});

document.getElementById('export-way').addEventListener('click', async function() {
  try{
    if (way.length > 0){
      let pathLonLat = [];
      // переводим путь из геграфических координат в формат [долгота, широта]
      way.forEach((coord)=>{ 
        pathLonLat.push(toLonLat(coord));
      });

      // Создаем объект LineString из координат
      const lineString = new LineString(pathLonLat);

      // Создаем объект Feature с геометрией LineString
      const feature = new Feature({
        geometry: lineString,
        name: 'Route'
      });

      // Преобразуем Feature в формат GeoJSON
      const geojsonFormat = new GeoJSON();
      const geojson = geojsonFormat.writeFeatureObject(feature);

      // Преобразуем GeoJSON в GPX
      function geojsonToGpx(geojson) {
        const gpxHeader = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
      <gpx version="1.1" creator="OpenLayers">
      <trk><name>Route</name><trkseg>`;
        const gpxFooter = `</trkseg></trk></gpx>`;
        const gpxContent = geojson.geometry.coordinates.map(coord => {
            return `<trkpt lat="${coord[1]}" lon="${coord[0]}"></trkpt>`;
        }).join('\n');
        return gpxHeader + gpxContent + gpxFooter;
      }

      const gpx = geojsonToGpx(geojson);

      // Функция для загрузки GPX файла
      function download(content, fileName, contentType) {
        const a = document.createElement("a");
        const file = new Blob([content], { type: contentType });
        a.href = URL.createObjectURL(file);
        a.download = fileName;
        a.click();
      } 
      // Скачиваем GPX файл
      download(gpx, 'route.gpx', 'application/gpx+xml');
    }
    else{
        alert('Путь не сформирован!');
    }
  }
  catch(error){
    alert('Не удалось скачать', error);
  }
});

document.getElementById('clear-all').addEventListener('click', async function() {
  try{
    // очистка точек-маркеров
    clearMarkers();
    // очистка маршрута
    clearWay();
    // очистка прямоугольника
    clearRec();
  }
  catch(error){
    alert('Не удалось выполнить операцию очистки', error);
  }
});

document.getElementById('btn-rec-visible').addEventListener('click', async function() {
  try{
    if (way.length == 0){
      // updateTileIndexes();
      createRectangle();
    }
    // меняем видимость прям.-ка и флаг видимости
    if (recVisibleFlag){
      vectorLayerRectangle.setVisible(false);
      recVisibleFlag = false;
    }
    else{
      vectorLayerRectangle.setVisible(true);
      recVisibleFlag = true;
    }
  }
  catch(error){
    alert('Не удалось выполнить операцию изменения видимости окна поиска', error);
  }
});

document.getElementById('window-plus').addEventListener('click', async function() {
  try{
    updateTileIndexes_plus();
    createRectangle();
  }
  catch(error){
    alert('Не удалось выполнить операцию увеличения окна поиска', error);
  }
});

document.getElementById('window-minus').addEventListener('click', async function() {
  try{
    updateTileIndexes_minus();
    createRectangle();
  }
  catch(error){
    alert('Не удалось выполнить операцию уменьшения окна поиска', error);
  }
});

async function getLanduseData(bbox, tags) {
  const query = `
      [out:json];
      (
        ${tags.map(tag => `way["${tag.key}"="${tag.value}"](${bbox}); relation["${tag.key}"="${tag.value}"](${bbox});`).join('')}
      );
      out body;
      >;
      out skel qt;
  `;
  console.log(query);
  const response = await fetch('https://overpass-api.de/api/interpreter', {
      method: 'POST',
      headers: {
          'Content-Type': 'application/x-www-form-urlencoded'
      },
      body: new URLSearchParams({ data: query }).toString()
  });

  if (!response.ok) {
      throw new Error('Failed to fetch data from Overpass API');
  }

  return await response.json();
}

function bboxPolygon_(topLeft, bottomRight) {
  const rectangleCoords = [
    [topLeft[0], topLeft[1]],
    [bottomRight[0], topLeft[1]],
    [bottomRight[0], bottomRight[1]],
    [topLeft[0], bottomRight[1]],
    [topLeft[0], topLeft[1]] // Замыкаем прямоугольник
  ];

  // Return a GeoJSON Polygon
  return {
      type: 'Polygon',
      coordinates: [rectangleCoords]
  };
}

// Function to draw a polygon on the canvas
function drawPolygon(coords, context, bbox, tileWidth_, tileHeight_) {
  context.beginPath();
  coords[0].forEach((coord, index) => {
    const x = (coord[0] - bbox[0]) / tileWidth_;
    const y = (bbox[3] - coord[1]) / tileHeight_;
    if (index === 0) {
      context.moveTo(x, y);
    } else {
      context.lineTo(x, y);
    }
  });
  context.closePath();
  context.fill();
}

function createMatrixForPolygon(topLeftLonLat, bottomRightLonLat, osmData) {
  const tileWidth_ = (bottomRightLonLat[0] - topLeftLonLat[0]) / width;
  const tileHeight_ = (topLeftLonLat[1] - bottomRightLonLat[1]) / height;
  //const bbox = `${bottomRightLonLat[1]},${topLeftLonLat[0]},${topLeftLonLat[1]},${bottomRightLonLat[0]}`;
  const bboxA = [topLeftLonLat[0], bottomRightLonLat[1], bottomRightLonLat[0], topLeftLonLat[1]];
  const bboxPolygon = bboxPolygon_(topLeftLonLat, bottomRightLonLat);

  //const osmData = await getLanduseData(bbox, landuseTags);

  // Создание карты узлов для быстрого доступа
  const nodesMap = new Map();
  osmData.elements.forEach(el => {
      if (el.type === 'node') {
          nodesMap.set(el.id, [el.lon, el.lat]);
      }
  });

  // Преобразуем данные в GeoJSON
  const geojson = osmtogeojson(osmData);

  // Выполняем пересечение каждого полигона с bbox
  const intersectedFeatures = geojson.features.map(feature => {
    const intersected = intersect(feature, bboxPolygon);
    return intersected ? intersected : null;
  }).filter(Boolean);

  // Создаем новый GeoJSON с пересеченными полигонами
  const intersectedGeoJSON = {
    type: 'FeatureCollection',
    features: intersectedFeatures
  };

  // Создание изображения и отображение точек
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext('2d');

  // Заполняем фон черным цветом
  context.fillStyle = 'black';
  context.fillRect(0, 0, width, height);

  // Draw polygons on the canvas
  context.fillStyle = 'white';
  intersectedGeoJSON.features.forEach(feature => {
    const coords = feature.geometry.coordinates;
    if (feature.geometry.type === 'Polygon') {
      drawPolygon(coords, context, bboxA, tileWidth_, tileHeight_);
    } else if (feature.geometry.type === 'MultiPolygon') {
      coords.forEach(polygon => drawPolygon(polygon, context, bboxA, tileWidth_, tileHeight_));
    }
  });

  // // Получаем данные изображения в формате PNG
  // const dataURL = canvas.toDataURL('image/png');

  // // Скачиваем изображение
  // const link = document.createElement('a');
  // link.href = dataURL;
  // link.download = 'water.png';
  // link.click();

  const imageData = context.getImageData(0, 0, width, height);
  const data = imageData.data;

  // создаем копию изображения в виде матрицы, если пиксель белый, то ячейка true
  const matrix = Array.from({ length: height }, () => Array(width).fill(false));

  for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
          const index = (y * width + x) * 4; // Индекс в массиве данных (RGBA)
          const r = data[index];
          const g = data[index + 1];
          const b = data[index + 2];
          
          // Проверяем, если пиксель белый (r, g, b == 255), то препятствие на этом месте есть
          if (r === 255 && g === 255 && b === 255) {
              matrix[y][x] = true;
          }
      }
  }

  return matrix;
}

async function getWaysData(bbox, tags) {
  const query = `
      [out:json];
      (
        ${tags.map(tag =>`way["${tag.value}"](${bbox});`).join('')}
      );
      out body;
      >;
      out skel qt;
  `;
  console.log(query);
  const response = await fetch('https://overpass-api.de/api/interpreter', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded'
    },
    body: new URLSearchParams({ data: query }).toString()
  });

  if (!response.ok) {
      throw new Error('Failed to fetch data from Overpass API');
  }

  return await response.json();
}

function drawLine(context, pixels) {
  // ставим проверку на возмсожность нарисовать линию
  let cnt=0;
  while (cnt < pixels.length){
    if (pixels[cnt][0]<0 || pixels[cnt][0]>width || pixels[cnt][1]<0 || pixels[cnt][1]>height){
      return;
    }
    cnt += 1;
  }
  // если все нормально, рисуем линпию
  context.beginPath();
  context.moveTo(pixels[0][0], pixels[0][1]);
  for (let i = 1; i < pixels.length; i++) {
      context.lineTo(pixels[i][0], pixels[i][1]);
  }
  context.strokeStyle = 'white';
  context.lineWidth = 2;
  context.stroke();
}

function createMatrixForWay(topLeftLonLat, bottomRightLonLat, osmData) {
  const tileWidth_ = (bottomRightLonLat[0] - topLeftLonLat[0]);
  const tileHeight_ = (topLeftLonLat[1] - bottomRightLonLat[1]);
  //const bbox = `${bottomRightLonLat[1]},${topLeftLonLat[0]},${topLeftLonLat[1]},${bottomRightLonLat[0]}`;
  //const bboxPolygon = bboxPolygon_(topLeftLonLat, bottomRightLonLat);

  //const osmData = await getWaysData(bbox, landuseTags);

  // Создание карты узлов для быстрого доступа
  const nodesMap = new Map();
  osmData.elements.forEach(el => {
      if (el.type === 'node') {
          nodesMap.set(el.id, [el.lon, el.lat]);
      }
  });

  const ways = osmData.elements.filter(el => el.type === 'way');

  // Создание изображения и отображение точек
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext('2d');

  // Заполняем фон черным цветом
  context.fillStyle = 'black';
  context.fillRect(0, 0, width, height);

  const bboxPolygon = bboxPolygon_([0,0], [width, height]);

  ways.forEach(way => {
    const nodes = way.nodes.map(nodeId => nodesMap.get(nodeId)).filter(Boolean);
    const pixels = findPixelsCoords(nodes, topLeftLonLat, tileWidth_, tileHeight_, width, height);
    const wayLine = lineString(pixels);
    // Обрезка линии по bbox
    const splitted = lineSplit(wayLine, bboxPolygon);
    if (splitted.features.length == 0)
    {
      drawLine(context, wayLine.geometry.coordinates);
    }
    else{
      splitted.features.forEach(segment => {
          const coords = segment.geometry.coordinates;
          drawLine(context, coords);
      });
    }
  });

  // // Получаем данные изображения в формате PNG
  // const dataURL = canvas.toDataURL('image/png');

  // // Скачиваем изображение
  // const link = document.createElement('a');
  // link.href = dataURL;
  // link.download = 'waterway.png';
  // link.click();

  const imageData = context.getImageData(0, 0, width, height);
  const data = imageData.data;

  // создаем копию изображения в виде матрицы, если пиксель белый, то ячейка true
  const matrix = Array.from({ length: height }, () => Array(width).fill(true));

  for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
          const index = (y * width + x) * 4; // Индекс в массиве данных (RGBA)
          const r = data[index];
          const g = data[index + 1];
          const b = data[index + 2];
          
          // Проверяем, если пиксель черный (r, g, b == 0)
          if (r === 0 && g === 0 && b === 0) {
              matrix[y][x] = false;
          }
      }
  }

  return matrix;
}