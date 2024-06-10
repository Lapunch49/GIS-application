  // const nodesMap = new Map();
  // osmData.elements.forEach(el => {
  //     if (el.type === 'node') {
  //       // let x=el.lat;
  //       // let y=el.lon;
  //       // if (x<topLeft[0] || x>topLeft[1] || y<bottomRight[0] || y>bottomRight[1]){
  //       //   x=topLeft[0];
  //       //   y=bottomRight[0];
  //       // }
  //         nodesMap.set(el.id, [el.lat,el.lon]);
  //     }
  // });

  // const waysMap = new Map(); // словарь - по id пути получаем массив его точек
  // osmData.elements.forEach(el => {
  //     if (el.type === 'way') {
  //       // let x=el.lat;
  //       // let y=el.lon;
  //       // if (x<topLeft[0] || x>topLeft[1] || y<bottomRight[0] || y>bottomRight[1]){
  //       //   x=topLeft[0];
  //       //   y=bottomRight[0];
  //       // }
  //         waysMap.set(el.id, el.nodes);
  //     }
  // });

  // way = 230097246;
  // console.log(waysMap.get(way));


  // Формируем полигональные объекты
//const landuseAreas = osmData.elements.filter(el => el.type === 'relation');

// const polygons = landuseAreas.map(area => {
//   let nodes = [];
//   area.members.forEach((way) => {
//     const nodesOfWay = waysMap.get(way.ref);
//   if (nodesOfWay){
//     nodes.push(...nodesOfWay);
//   }
// });
//     //const nodes = (area.members && area.members.filter(m => m.type === 'way').flatMap(m => waysMap.get(m)));
//     if (nodes.length > 0) {
//         const polygonCoords = nodes.map(nodeId => nodesMap.get(nodeId)).filter(Boolean);
//         if (polygonCoords.length >= 4) { // Достаточно координат для полигона
//             // Закрываем полигон
//             if (polygonCoords[0][0] !== polygonCoords[polygonCoords.length - 1][0] ||
//                 polygonCoords[0][1] !== polygonCoords[polygonCoords.length - 1][1]) {
//                 polygonCoords.push(polygonCoords[0]);
//             }
//             const poly = polygon([polygonCoords]);
//             const clippedPoly = clipPolygon(poly, bboxPolygon);
//             if (clippedPoly) {
//               console.log(clippedPoly.elements == poly.elements);
//                 return clippedPoly;
//             }
//         }
//     }
//     return null;
// }).filter(Boolean);


// // Формируем полигональные объекты
// const landuseAreas = osmData.elements.filter(el => el.type === 'way' || el.type === 'relation');
// const polygons = landuseAreas.map(area => {
//     const nodes = area.nodes || (area.members && area.members.filter(m => m.type === 'way').flatMap(m => m.nodes)) || [];
//     if (nodes.length > 0) {
//         const polygonCoords = nodes.map(nodeId => nodesMap.get(nodeId)).filter(Boolean);
//         if (polygonCoords.length >= 4) { // Достаточно координат для полигона
//             // Закрываем полигон
//             if (polygonCoords[0][0] !== polygonCoords[polygonCoords.length - 1][0] ||
//                 polygonCoords[0][1] !== polygonCoords[polygonCoords.length - 1][1]) {
//                 polygonCoords.push(polygonCoords[0]);
//             }
//             polygons.push(...polygonCoords);
//             return polygon([polygonCoords]);
//             // const poly = polygon([polygonCoords]);
//             // const clippedPoly = clipPolygon(poly, bboxPolygon);
//             // if (clippedPoly) {
//             //   console.log(clippedPoly.elements == poly.elements);
//             //     return clippedPoly;
//             // }
//         }
//     }
//     return null;
// }).filter(Boolean);

// // Создаем матрицу
// const matrix = Array.from({ length: rows }, () => Array(cols).fill(false));

// // Заполняем матрицу данными
// for (let r = 0; r < rows; r++) {
//     for (let c = 0; c < cols; c++) {
//         const x = topLeft[0] + c * tileWidth;
//         const y = topLeft[1] - r * tileHeight;

//         const pointCoord = point([x, y]);
//         for (const poly of polygons) {
//             if (booleanPointInPolygon(pointCoord, poly)) {
//                 matrix[r][c] = true;
//                 break; // Как только нашли совпадение, выходим из цикла
//             }
//         }
//     }
// }


// //   // Преобразуем координаты узлов в пиксельные координаты
// //   const nodeCoordinates = getNodeCoordinates(osmData);
// //   let nodeCoordinates_ = [];
// //   for (let i=0; i<nodeCoordinates.length; i++){
// //     nodeCoordinates_.push(fromLonLat(nodeCoordinates[i]));
// //   }
// //   let width = cols;
// //   let height = rows;
// //   const pixelCoordinates = findPixelsCoords(nodeCoordinates_, topLeft, tileWidth_, tileHeight_, width, height);

// //   // Создание изображения и отображение точек
// //   const canvas = document.createElement('canvas');
// //   canvas.width = width;
// //   canvas.height = height;
// //   const context = canvas.getContext('2d');

// //   // Заполняем фон черным цветом
// //   context.fillStyle = 'black';
// //   context.fillRect(0, 0, width, height);

// //   // Рисуем белые точки на пиксельных координатах
// //   context.fillStyle = 'white';
// //   for (let i = 0; i < pixelCoordinates.length; i++) {
// //     const [x, y] = pixelCoordinates[i];
// //     context.fillRect(x, y, 1, 1); // Рисуем точку размером 3x3 пикселя

// //     if (i > 0) {
// //         const [prevX, prevY] = pixelCoordinates[i - 1];
// //         drawLine(prevX, prevY, x, y, context);
// //     }
// // }
// //   // Получить данные изображения в формате PNG
// //   const dataURL = canvas.toDataURL('image/png');
// //   //Либо скачать изображение
// //   const link = document.createElement('a');
// //   link.href = dataURL;
// //   link.download = 'water.png';
// //   link.click();
// }


// function coordinatesToPixels(coord,topLeft, tileWidth, tileHeight, width, height){
//   let x=coord[0];
//   let y=coord[1];
//   const pixelX = Math.floor((x - topLeft[0]) / tileWidth * width);
//   const pixelY = Math.floor((topLeft[1] - y) / tileHeight * height);
//   return [pixelX,pixelY];

// }

// async function geoJsonToMatrix(topLeft, bottomRight, width, height, landuseTags, matrix){
//   const bbox = `${bottomRight[1]},${topLeft[0]},${topLeft[1]},${bottomRight[0]}`;
//   // bottomRight = fromLonLat(bottomRight);
//   // topLeft = fromLonLat(topLeft);

//   const osmData = await getLanduseData(bbox, landuseTags);

//   osmData.elements.forEach(feature => {
//     if (feature.type === 'Point') {
//       const [x, y] = coordinatesToPixels(feature.coordinates, bounds, width, height);
//       if (x >= 0 && x < width && y >= 0 && y < height) {
//         matrix[y][x] = true; // Отметьте пиксель как занятый
//       }
//     } else if (feature.type === 'LineString' || feature.type === 'Polygon') {
//       const coords = feature.type === 'Polygon' ? feature.coordinates[0] : feature.coordinates;
//       coords.forEach(coord => {
//         const [x, y] = coordinatesToPixels(coord, bounds, width, height);
//         if (x >= 0 && x < width && y >= 0 && y < height) {
//           matrix[y][x] = true; // Отметьте пиксель как занятый
//         }
//       });
//     }
//   });
//   renderMatrix(matrix);


function renderMatrix(matrix) {
    const canvas = document.getElementById('canvas');
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = 'black';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
  
    ctx.fillStyle = 'white';
    for (let y = 0; y < matrix.length; y++) {
      for (let x = 0; x < matrix[y].length; x++) {
        if (matrix[y][x] === true) {
          ctx.fillRect(x, y, 1, 1);
        }
      }
    }
  }


  // Получаем координаты узлов из ответа Overpass API
function getNodeCoordinates(response) {
    const nodes = response.elements.filter(element => element.type === 'node');
    return nodes.map(node => [node.lon, node.lat]);
  }
  
  // Алгоритм Брезенхема для рисования линий между двумя точками
  function drawLine(x0, y0, x1, y1, context) {
    const dx = Math.abs(x1 - x0);
    const dy = Math.abs(y1 - y0);
    const sx = (x0 < x1) ? 1 : -1;
    const sy = (y0 < y1) ? 1 : -1;
    let err = dx - dy;
  
    while (true) {
        context.fillRect(x0, y0, 1, 1); // Рисуем пиксель
  
        if ((x0 === x1) && (y0 === y1)) break;
        const e2 = 2 * err;
        if (e2 > -dy) {
            err -= dy;
            x0 += sx;
        }
        if (e2 < dx) {
            err += dx;
            y0 += sy;
        }
    }
  }