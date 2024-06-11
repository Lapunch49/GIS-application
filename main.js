import MapOL from 'ol/Map.js';
import View from 'ol/View.js';
import {Image as ImageLayer, Tile as TileLayer} from 'ol/layer.js';
import {OSM, Raster, XYZ, Vector} from 'ol/source.js';
import Feature from 'ol/Feature.js';
import Point from 'ol/geom/Point.js';
import Polygon from 'ol/geom/Polygon.js';
import LineString from 'ol/geom/LineString';
import { Stroke, Style } from 'ol/style';
import VectorLayer from 'ol/layer/Vector.js';
//import { get as getProjection,fromLonLat,toLonLat  } from 'ol/proj';
import { createXYZ } from 'ol/tilegrid';
import {Grid, a_star} from './algorithm.js';
import { toLonLat } from 'ol/proj.js';
import GeoJSON from 'ol/format/GeoJSON.js';
//import { polygon, point, booleanPointInPolygon, intersect } from '@turf/turf';
import { lineString, lineSplit, intersect} from '@turf/turf';
import osmtogeojson from 'osmtogeojson';

const pointsOnMap = [];
let ZOOM = 15; // уровень масштабирования для алгоритма
let way  = []; // путь на карте (массив точек в формате географических координат)
let kMountain=2; //1,2,4
let kForest = 2; //1, 2, 4
let startTime = 0;
let endTime = 0;

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
function findPixelsCoords(coordinatesAll,topLeft, tileWidth, tileHeight, width, height){ // здесь tileWidth, tileHeight - размеры сторон тайлов
  let pixelsAll =[];
  for (const [x, y] of coordinatesAll){
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

  console.log(width, height);

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
  // Нижний правый угол экстента (в проекции карты)
  const downRight = [extentMax[2], extentMax[1]];
  const topLeftLonLat = toLonLat(topLeft);
  const downRightLonLat = toLonLat(downRight);

  //Ширина и высота экстента изображения
  const tileWidth = extentMax[2]-extentMin[0];
  const tileHeight = extentMin[3]-extentMax[1];

  const waterTags = [{ key: 'natural', value: 'water' }, {key: 'natural', value: 'wetland' }];
  const forestTags = [{ key: 'landuse', value: 'forest' }, { key: 'natural', value: 'wood' }];
  const waterwayTags = [
    { value:'waterway'}
  ];

  let waterMatrix=[];
  let forestMatrix=[];
  let waterwayMatrix=[];
  
  // let obstacleMatrix = Array.from({ length: width }, () => Array(height).fill(false));
  // waterMatrix = await geoJsonToMatrix(topLeftLonLat, downRightLonLat, height, width, waterTags, obstacleMatrix)
  //console.log('Water Query:');
  waterMatrix = await createMatrix(topLeftLonLat, downRightLonLat, height, width, waterTags);

  waterwayMatrix = await createMatrixForWay(topLeftLonLat, downRightLonLat, height, width, waterwayTags);
  //console.log('Waterway Query:');

  forestMatrix = await createMatrix(topLeftLonLat, downRightLonLat, height, width, forestTags);
  //console.log('Forest Query:');

  // объединяем инфу обо всех водных объектах в waterMatrix
  for (let i=0; i<height; i++){
    for (let j=0; j<width; j++){
      waterMatrix[i][j] = waterMatrix[i][j] || (waterwayMatrix[i][j]);
    }
  }

  // Вычисляем координаты наших точек на изображении
  const pointsArrPixels = findPixelsCoords(pointsArr,topLeft,tileWidth,tileHeight, width, height);

  let pathOnMap = [];
  const matrix = [];

  await loadAllTiles().then(() => {
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
         
      // Либо скачать изображение
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
    let grid=new Grid(width, height, pointsArrPixels[i], pointsArrPixels[i+1], matrix, waterMatrix, forestMatrix );
    grids.push(grid);
  }
  // для каждой пары точек находим мин. путь
  // если путь для какого-то участка не найден, останавливаемся и выводим сообщение об этом
  let pathTotal =[];
  let flag=false;
  const startTime2 = performance.now();
  for (let i=0; i<grids.length; i++){
    let path = a_star(grids[i], ZOOM, kMountain, kForest);
    if (path.length == 0){
      flag=true;
      break;
    } else{
      pathTotal.push(path);
    }
  }
  const endTime2 = performance.now();

  // Вычисление и вывод времени выполнения
  const timeTaken2 = endTime2 - startTime2;
  console.log(`Время выполнения: ${timeTaken2.toFixed(2)} миллисекунд`);

  // если все пути были найдены
  if (!flag){
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
  return [pathOnMap, topLeft, downRight];
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
    center: [6220000, 7315000],
    //center: fromLonLat([272.0066751135746, 437.0117187501164]),
    zoom: 14,
  }),
});

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
  
  // // Очищаем ссылку и объект URL после завершения скачивания
  // window.URL.revokeObjectURL(url);
  // document.body.removeChild(a);
  //try{
    startTime = performance.now();
    let [wayL,topLeft, downRight] = await makeImage(pointsOnMap);
    endTime = performance.now();
    console.log("Кол-во точек маршрута:", wayL.length);
    // Вычисление и вывод времени выполнения
    const timeTaken = endTime - startTime;
    console.log(`Общее время выполнения: ${timeTaken.toFixed(2)} миллисекунд`);
    
    let pathFeature = new Feature({
      geometry: new LineString(wayL),
      name: 'Route'
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
    way=wayL; // почему-то иначе не работает порядок срабатывания действий : await makeImage - не дожидается выполнения

    // добавляем прямоугольник на карту
    // Создание геометрии прямоугольника
    const rectangleCoords = [
      [topLeft[0], topLeft[1]],
      [downRight[0], topLeft[1]],
      [downRight[0], downRight[1]],
      [topLeft[0], downRight[1]],
      [topLeft[0], topLeft[1]] // Замыкаем прямоугольник
    ];

    // Создание объекта Feature с геометрией типа Polygon
    const rectangleFeature = new Feature({
      geometry: new Polygon([rectangleCoords])
    });

    // Создание векторного источника и слоя
    const vectorSourceRec = new Vector({
      features: [rectangleFeature]
    });
    const vectorLayerRec = new VectorLayer({
      source: vectorSourceRec
    });

  // Добавление векторного слоя на карту
  map.addLayer(vectorLayerRec);

    // } 
    // catch {
    //   alert('Произошла ошибка:');
    // }
  
    // map.setView(new View({
    //   center: way[0],
    //   zoom: 15,
    // }),)

  
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

function pointInPolygon(point, vs) {
  var x = point[0], y = point[1];
  var inside = false;
  for (var i = 0, j = vs.length - 1; i < vs.length; j = i++) {
      var xi = vs[i][0], yi = vs[i][1];
      var xj = vs[j][0], yj = vs[j][1];
      var intersect = ((yi > y) != (yj > y)) && (x < (xj - xi) * (y - yi) / (yj - yi) + xi);
      if (intersect) inside = !inside;
  }
  return inside;
}

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


function bboxPolygon_(bbox) {
  // bbox is an array in the format [minX, minY, maxX, maxY]
  const [minX, minY, maxX, maxY] = bbox;

  // Create a polygon representing the bounding box
  const coordinates = [
      [minX, minY], // bottom-left
      [minX, maxY], // top-left
      [maxX, maxY], // top-right
      [maxX, minY], // bottom-right
      [minX, minY]  // closing the polygon by returning to the bottom-left
  ];

  // Return a GeoJSON Polygon
  return {
      type: 'Polygon',
      coordinates: [coordinates]
  };
}

function clipPolygon(polygon, bboxPolygon) {
  return intersect(polygon, bboxPolygon);
}

// Function to draw a polygon on the canvas
function drawPolygon(coords, context, bbox, tileWidth, tileHeight) {
  context.beginPath();
  coords[0].forEach((coord, index) => {
    const x = (coord[0] - bbox[0]) / tileWidth;
    const y = (bbox[3] - coord[1]) / tileHeight;
    if (index === 0) {
      context.moveTo(x, y);
    } else {
      context.lineTo(x, y);
    }
  });
  context.closePath();
  context.fill();
}

async function createMatrix(topLeft, bottomRight, rows, cols, landuseTags) {
  const tileWidth = (bottomRight[0] - topLeft[0]) / cols;
  const tileHeight = (topLeft[1] - bottomRight[1]) / rows;
  const bbox = `${bottomRight[1]},${topLeft[0]},${topLeft[1]},${bottomRight[0]}`;
  const bboxA = [topLeft[0], bottomRight[1], bottomRight[0], topLeft[1]];
  const bboxPolygon = bboxPolygon_(bboxA);
  // Функция для обрезки полигона по границам bbox

  const osmData = await getLanduseData(bbox, landuseTags);

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
  const width = cols;
  const height = rows;
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
      drawPolygon(coords, context, bboxA, tileWidth, tileHeight);
    } else if (feature.geometry.type === 'MultiPolygon') {
      coords.forEach(polygon => drawPolygon(polygon, context, bboxA, tileWidth, tileHeight));
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
  context.beginPath();
  context.moveTo(pixels[0][0], pixels[0][1]);
  for (let i = 1; i < pixels.length; i++) {
      context.lineTo(pixels[i][0], pixels[i][1]);
  }
  context.strokeStyle = 'white';
  context.lineWidth = 2;
  context.stroke();
}

async function createMatrixForWay(topLeft, bottomRight, rows, cols, landuseTags) {
  const tileWidth = (bottomRight[0] - topLeft[0]);
  const tileHeight = (topLeft[1] - bottomRight[1]);
  const bbox = `${bottomRight[1]},${topLeft[0]},${topLeft[1]},${bottomRight[0]}`;
  const bboxA = [topLeft[0], bottomRight[1], bottomRight[0], topLeft[1]];
  const bboxPolygon = bboxPolygon_(bboxA);
  // Функция для обрезки полигона по границам bbox

  const osmData = await getWaysData(bbox, landuseTags);

  // Создание карты узлов для быстрого доступа
  const nodesMap = new Map();
  osmData.elements.forEach(el => {
      if (el.type === 'node') {
          nodesMap.set(el.id, [el.lon, el.lat]);
      }
  });

  const waterways = osmData.elements.filter(el => el.type === 'way');

  // Создание изображения и отображение точек
  const width = cols;
  const height = rows;
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext('2d');

  // Заполняем фон черным цветом
  context.fillStyle = 'black';
  context.fillRect(0, 0, width, height);

  waterways.forEach(way => {
    const nodes = way.nodes.map(nodeId => nodesMap.get(nodeId)).filter(Boolean);
    const wayLine = lineString(nodes);
        // Обрезка линии по bbox
        const clipped = lineSplit(wayLine, bboxPolygon);
        clipped.features.forEach(segment => {
            const coords = segment.geometry.coordinates;
            const pixels = findPixelsCoords(coords, topLeft, tileWidth, tileHeight, width, height);
            drawLine(context, pixels);
        });
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