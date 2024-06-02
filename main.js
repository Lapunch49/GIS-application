import Map from 'ol/Map.js';
import View from 'ol/View.js';
import {Image as ImageLayer, Tile as TileLayer} from 'ol/layer.js';
import {OSM, Raster, XYZ, Vector} from 'ol/source.js';
import Feature from 'ol/Feature.js';
import Point from 'ol/geom/Point.js';
import LineString from 'ol/geom/LineString';
import { Stroke, Style } from 'ol/style';
import VectorLayer from 'ol/layer/Vector.js';
//import { get as getProjection,fromLonLat,toLonLat  } from 'ol/proj';
import { createXYZ } from 'ol/tilegrid';
//import { fromEPSGCode } from 'ol/proj/proj4.js';
import {Grid, a_star} from './algorithm.js';
import { fromLonLat } from 'ol/proj.js';

const pointsOnMap = [];
let ZOOM = 15; // уровень масштабирования для алгоритма

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

// Вычисляем положение точек внутри изображения (из координат в пиксели)
function findPixelsCoords(coordinatesAll,topLeft, tileWidth, tileHeight, width, height){
  let pixelsAll =[];
  for (let i=0; i<coordinatesAll.length; i++){
    let x=coordinatesAll[i][0];
    let y=coordinatesAll[i][1];
    const pixelX = Math.floor((x - topLeft[0]) / tileWidth * width);
    const pixelY = Math.floor((topLeft[1] - y) / tileHeight * height);
    pixelsAll.push([pixelX,pixelY])
  } 
  return pixelsAll;
}

// Вычисляем положение точек внутри изображения (из пикселей в координаты)
function findCoordsPixels(pixelsAll,topLeft, grid){
  let coordinatesAll =[];
  pixelsAll.forEach((pixel)=>{
      let x = pixel.x*grid.dictZoomPixelLen.get(ZOOM)+topLeft[0];
      let y = topLeft[1]-pixel.y*grid.dictZoomPixelLen.get(ZOOM);
      coordinatesAll.push([x,y]);
    });
  return coordinatesAll;
}

async function makeImage(pointsArr){
  const TILE_SIZE = 256;
  const sourceURL = 'https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png';

  // Создаем TileGrid для уровня масштабирования
  const tileGrid = createXYZ({ maxZoom: ZOOM });

  // Получаем индексы тайлов, в которых оказались наши точки
  let xMax = 0;
  let xMin = 32768; // максимально возможный +1 индекс тайла для zoom=15
  let yMax = 0;
  let yMin = 32768;
  pointsArr.forEach((point)=>{
    // Получаем индексы тайла, в котором оказалась наша точка
    let [tileIndexX,tileIndexY] = tileGrid.getTileCoordForCoordAndZ(point, ZOOM).slice(1);
    // Обновляем мин. и макс. индексы - граничные индексы тайлов(верхнего левого и правого нижнего), которые будем скачивать
    xMax = Math.max(xMax,tileIndexX);
    xMin = Math.min(xMin,tileIndexX);
    yMax = Math.max(yMax,tileIndexY);
    yMin = Math.min(yMin,tileIndexY);
  });

  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d');

  // Размер итогового изображения
  const width = (xMax - xMin + 1) * TILE_SIZE;
  const height = (yMax - yMin + 1) * TILE_SIZE;

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

  // Получаем экстент тайлов topLeft и downRight
  const extentMin = tileGrid.getTileCoordExtent([ZOOM, xMin, yMin]);
  const extentMax = tileGrid.getTileCoordExtent([ZOOM, xMax, yMax]);

  // Верхний левый угол экстента (в проекции карты)
  const topLeft = [extentMin[0], extentMin[3]];

  // Ширина и высота экстента изображения
  const tileWidth = extentMax[2]-extentMin[0];
  const tileHeight = extentMin[3]-extentMax[1];

  // Вычисляем координаты наших точек на изображении
  const pointsArrPixels = findPixelsCoords(pointsArr,topLeft,tileWidth,tileHeight, width, height);

  let pathOnMap = [];

  loadAllTiles().then(() => {
      // Получить данные изображения в формате PNG
      //const dataURL = canvas.toDataURL('image/png');

      // Создать матрицу = изображению
      const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
      const data = imageData.data;
      const matrix = [];

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
      // создадим сетки для каждой части пути(для каждой пары начала и конца пути)
      let grids = []; 
      for (let i=0; i<pointsArrPixels.length-1; i++){
        // создаем массив(сетку), каждая ячейка которого Cell содержит инф. о x,y,heigth пикселя, а также gScore, fScore, isAbsacle и др.
        // также для каждой сетки известны свои координаты начала и конца пути(для каждой пары точек)
        let grid=new Grid(width, height,pointsArrPixels[i], pointsArrPixels[i+1], matrix);
        grids.push(grid);
      }
      // для каждой пары точек находим мин. путь
      // если путь для какого-то участка не найден, останавливаемся и выводим сообщение об этом
      let pathTotal =[];
      for (let i=0; i<grids.length; i++){
        let path = a_star(grids[i], ZOOM);
        if (path == []){
          break;
        } else{
          pathTotal.push(path);
        }
      }
      // если все пути были найдены
      if (pathTotal.length == grids.length){
        let pathOnMapTotal=[];
        // переводим координаты пикселей в координаты на карте(EPSG:4326), изначально перевернув их(т.к. алгоритм формирует пути с конца)
        for (let i=0; i<grids.length; i++){
          let pathOnMapPart = findCoordsPixels(pathTotal[i].reverse(),topLeft,grids[i]);
          pathOnMapTotal.push(pathOnMapPart);
        }
        // соединяем все пути и точки вместе
        for (let i=0; i<pathOnMapTotal.length; i++){
          pathOnMap.push(pointsArr[i]);
          pathOnMap.push(...pathOnMapTotal[i]);
        }
        // соединяем с посл. точкой
        pathOnMap.push(pointsArr[pointsArr.length-1]);

        console.log(pathOnMap);
      }
      // если какой-то путь не был найден
      else{
        if (pointsArrPixels.length == 2){
          alert('Не удалось найти путь, попробуйте увеличить размер окна поиска');
        }
        else{
          let indexOfPath = pathOnMapTotal.length+1;
          alert('Не удалось найти маршрут на промежутке между', indexOfPath, ' и ', indexOfPath+1, 'точками');
        }
      }
      
      // Либо скачать изображение
      // const link = document.createElement('a');
      // link.href = dataURL;
      // link.download = 'map.png';
      // link.click();

  });

  await loadAllTiles();
  // возвращаем путь в координатах проекции карты(EPSG:4326)
  return pathOnMap;
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

// const terrainLayer = new TileLayer({
//   source: elevation,
//   opacity: 0.0,
// });

const map = new Map({
  target: 'map',
  layers: [
    new TileLayer({
      source: new OSM(),
    }),
    new ImageLayer({
      opacity: 0.3,
      source: raster,
    }),
    //terrainLayer,
  ],
  view: new View({
    center: [6220000, 7315000],
    //center: fromLonLat([272.0066751135746, 437.0117187501164]),
    zoom: 14,
  }),
});

// layerSwitcher = new Control.LayerSwitcher();
// map.addControl(layerSwitcher);


const controlIds = ['vert', 'sunEl', 'sunAz'];
const controls = {};
controlIds.forEach(function (id) {
  const control = document.getElementById(id);
  const output = document.getElementById(id + 'Out');
  control.addEventListener('input', function () {
    output.innerText = control.value;
    raster.changed();
  });
  output.innerText = control.value;
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


map.on('click', async function(event) {
  const coordinates = event.coordinate; // Получить координаты клика

  // Сохранить координаты в массиве
  pointsOnMap.push(coordinates);

  // Создать метку на карте
  const marker = new Feature({
    geometry: new Point(coordinates)
  });

  const vectorSource = new Vector({
    features: [marker]
  });

  const vectorLayer = new VectorLayer({
    source: vectorSource
  });

  map.addLayer(vectorLayer);

  console.log(pointsOnMap);
});

document.getElementById('find-way').addEventListener('click', async function() {
  // // Ждем события postcompose
  // const a = document.createElement('a');
  // document.body.appendChild(a);
  // a.href = url;
  // a.download = 'map.png'; // Имя файла
  // // Запускаем скачивание изображения
  // a.click();
  // // Очищаем ссылку и объект URL после завершения скачивания
  // window.URL.revokeObjectURL(url);
  // document.body.removeChild(a);

    // try{
    let transformedCoordinates  = await makeImage(pointsOnMap);
    console.log(transformedCoordinates);

    const pathFeature = new Feature({
      geometry: new LineString(transformedCoordinates)
    });
  
    // Создаем слой векторных объектов и добавляем линию
    const vectorSource = new Vector({
        features: [pathFeature]
    });
  
    const vectorLayer = new VectorLayer({
        source: vectorSource,
        style: new Style({
            stroke: new Stroke({
                color: '#ff0000',
                width: 3
            })
        })
    });
    // Добавляем векторный слой на карту
    map.addLayer(vectorLayer);
    // } 
    // catch {
    //   alert('Произошла ошибка:');
    // }
  
    // map.setView(new View({
    //   center: transformedCoordinates[0],
    //   zoom: 15,
    // }),)
  
})
