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

const coordinatesAll = [];
const pixelcoordinatesAll = [];
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
function findCoordsPixels(pixelsAll,topLeft, tileWidth, tileHeight, width, height){
  let coordinatesAll =[];
  for (let i=0; i<pixelsAll.length; i++){
    let pixelX=pixelsAll[i].x;
    let pixelY=pixelsAll[i].y;
    let x = (pixelX / width) * tileWidth + topLeft[0];
    let y = topLeft[1] - (pixelY / height) * tileHeight;
    coordinatesAll.push([x,y])
  } 
  return coordinatesAll;
}

async function makeImage(coordinates_arr){
  const TILE_SIZE = 256;
  const sourceURL = 'https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png';

  // Создаем TileGrid для уровня масштабирования
  const tileGrid = createXYZ({ maxZoom: ZOOM });

  // Получаем индексы тайлов
  const tileIndex1 = tileGrid.getTileCoordForCoordAndZ(coordinates_arr[0], ZOOM);
  const tileIndex2 = tileGrid.getTileCoordForCoordAndZ(coordinates_arr[1], ZOOM);

  const [x1, y1] = tileIndex1.slice(1); // Индексы x и y первой точки
  const [x2, y2] = tileIndex2.slice(1); // Индексы x и y второй точки
  const xMax = Math.max(x1,x2);
  const xMin = Math.min(x1,x2);
  const yMax = Math.max(y1,y2);
  const yMin = Math.min(y1,y2);

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
  const pixelsAll = findPixelsCoords(coordinatesAll,topLeft,tileWidth,tileHeight, width, height);

  let path_on_map = [];

  loadAllTiles().then(() => {
      // Получить данные изображения в формате PNG
      const dataURL = canvas.toDataURL('image/png');

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
      // создаем массив(сетку), каждая ячейка которого Cell содержит инф. о x,y,heigth пикселя, а также gScore, fScore, isAbsacle и др.
      let grid=new Grid(width, height,pixelsAll[0], pixelsAll[1], matrix);
      //ZOOM = map.getView.ZOOM;
      let path = a_star(grid, ZOOM);
      // path.forEach((obj)=>{
      //   let x = obj.x*grid.dictZoomPixelLen.get(ZOOM)+topLeft[0];
      //   let y = topLeft[1]-obj.y*grid.dictZoomPixelLen.get(ZOOM);
      //   path_on_map.push([x,y]);
      // });
      path_on_map = findCoordsPixels(path,topLeft, tileWidth, tileHeight, width, height);

      // Либо скачать изображение
      // const link = document.createElement('a');
      // link.href = dataURL;
      // link.download = 'map.png';
      // link.click();

      console.log(path);
  });

  await loadAllTiles();
  return path_on_map;

  // индексы x y для верхнего левого тайла
  // topLeft - координаты(в метрах) левого верзнего пикселя
  // координаты пикселей всех точек из массива coordinatesAll
  // матрицу = изображению
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
    zoom: 15,
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
  const pixelCoordinates = map.getPixelFromCoordinate(coordinates);

  // Сохранить координаты в массиве
  coordinatesAll.push(coordinates);
  pixelcoordinatesAll.push(pixelCoordinates);

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

  console.log(coordinatesAll);
  console.log(pixelcoordinatesAll);
  if (coordinatesAll.length == 2){

  //   createHeightMatrixFromTiles(tileUrlTemplate)
  // .then(heightMatrix => {
  //   console.log('Матрица высот:', heightMatrix);
  // })
  // .catch(error => {
  //   console.error('Произошла ошибка:', error);
  // });

  let transformedCoordinates  = await makeImage(coordinatesAll); 

  // map.setView(new View({
  //   center: transformedCoordinates[0],
  //   zoom: 15,
  // }),)

  //const pathCoordinates = await loadPathCoordinates();
  //transformedCoordinates = transformedCoordinates.map(coord => toLonLat(coord));
  // индексы и коордианты (в проекции EPSG:3857) для верхнего левого пикселя изображения
  // topLeft - координаты(в метрах) левого верзнего пикселя
  // координаты пикселей всех точек из массива coordinatesAll
  // матрицу = изображению
  // Создаем линию из координат пути
  // Координаты пути (должны быть в формате [долгота, широта])

// Преобразуем координаты пути в проекцию карты
//transformedCoordinates = pathCoordinates.map(coord => fromLonLat(coord));

// Проверка преобразованных координат
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
            width: 2
        })
    })
});

// Добавляем векторный слой на карту
map.addLayer(vectorLayer);

  }
});

// document.getElementById('export-png').addEventListener('click', function() {
//   // Ждем события postcompose
//   const a = document.createElement('a');
//   document.body.appendChild(a);
//   a.href = url;
//   a.download = 'map.png'; // Имя файла
//   // Запускаем скачивание изображения
//   a.click();
//   // Очищаем ссылку и объект URL после завершения скачивания
//   window.URL.revokeObjectURL(url);
//   document.body.removeChild(a);
// })
