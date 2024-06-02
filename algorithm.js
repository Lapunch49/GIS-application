// initializing global variables
var grid;

    //---- Some useful functions ----------
Array.prototype.remove = function(elem){
	if (this.indexOf(elem) == -1){
		console.log(this);
		console.log(elem)
		console.log(this.includes(grid.start))
		throw "Please comment if you see this error"
	}
	this.splice(this.indexOf(elem), 1);
	return this
};

// for phones without es6 support
Array.prototype.includes = function(elem) {
	return this.indexOf(elem) != -1
};

function heuristic(node, goal, zoom, grid) {
    // Diagonal distance - octile distance
    let dx = Math.abs(node.x - goal.x);
    let dy = Math.abs(node.y - goal.y);
    return grid.dictZoomPixelLen.get(zoom) * ((dx + dy) + ( Math.sqrt(2) - 2) *  Math.min(dx, dy));
    //Manhattan distance
    //return Math.abs(current.x - end.x) + Math.abs(current.y - end.y);
};

function tentativeG(current, neighbor, grid, zoom){
    const delta = Math.abs(current.h - neighbor[0].h); // slope, triangle catheter
    let delta_gScore;

    // delta = 0;
    // pixelLength =1;
    // pixelDiagonal=Math.sqrt(2);

    if (neighbor[1] == 1){ // forward heighbor
        delta_gScore = Math.sqrt(Math.pow(grid.dictZoomPixelLen.get(zoom),2) + delta*delta);
    } else{ // diagonal neighobor
        delta_gScore = Math.sqrt(Math.pow(grid.dictZoomPixelLen.get(zoom)*Math.sqrt(2),2) + delta*delta);
    }
    return current.gScore + delta_gScore;
    //return 0;
};

class Grid {
    columns = 0;
    rows = 0;

    // this map is really important as it keeps track of the path
    // in the best way I can put this, it acts like a traceback where each cell points to the cell traversed next
    cameFrom = new Map();
    dictZoomPixelLen = new Map();

    // cells kept for analysing
    openSet = [];
    // cells analysed
    closedSet = [];
    start = [];
    
    // the destination
    end = [];
    _arr=[];

    constructor(columns, rows, start, end, matrix) {
        this.columns = columns;
        this.rows = rows;

        // this map is really important as it keeps track of the path
        // in the best way I can put this, it acts like a traceback where each cell points to the cell traversed next
        this.cameFrom = new Map();
        this.dictZoomPixelLen.set(15, 4.773);
        //this.dictZoomPixelLen.set(15, 1222.99/256);
        this.dictZoomPixelLen.set(14, 9.547);
        //this.dictZoomPixelLen.set(14, 2445.98/256);
        this.dictZoomPixelLen.set(13, 19.093);
        this.dictZoomPixelLen.set(12, 38.187);
        this.dictZoomPixelLen.set(11, 76.373);
        this.dictZoomPixelLen.set(10, 152.746);
        this.dictZoomPixelLen.set(9, 305.492);
        this.dictZoomPixelLen.set(8, 610.984);
        this.dictZoomPixelLen.set(7, 1222);
        this.dictZoomPixelLen.set(6, 2444);
        this.dictZoomPixelLen.set(5, 4888);
        this.dictZoomPixelLen.set(4, 9776);
        this.dictZoomPixelLen.set(3, 19551);
        this.dictZoomPixelLen.set(2, 39103);
        this.dictZoomPixelLen.set(1, 78206);

        // cells kept for analysing
        this.openSet = [];
        // cells analysed
        this.closedSet = [];

        // builds and renders the grid
        let c = 0; //top = 0;
        for (let i = 0; i < columns; i++) {
            let temp = [];
            for (let j = 0; j < rows; j++) {
                let cell = new Cell(i, j, matrix[j][i], ++c);
                if ((i == start[0]) && (j == start[1])) cell.is_start = true;
                if ((i == end[0]) && (j == end[1])) cell.is_end = true;

                //top += height;
                temp.push(cell);
            }
            //top = 0;
            this._arr.push(temp);
        }

        // the starting cell
        this.start = this._arr[start[0]][start[1]];
        this.start.is_start = true;
        this.start.visited = true;
        this.start.gScore = 0;
        this.openSet.push(this.start);

        // the destination
        this.end = this._arr[end[0]][end[1]];
        this.end.is_end = true;
    }

    // finds the cell at a given coordinate
    at = function(x, y) {
        return (y === undefined) ? this._arr[x[0]][x[1]] : this._arr[x][y];
    };

    // finds the lowest f-score (see the Cell object below) in the openSet (the cells to be analysed)
    lowest_f = function() {
        let lowest = this.openSet[0];
        for (let j of this.openSet) {
            if (lowest.fScore > j.fScore)
                lowest = j;
        }
        return lowest;
    };

    reset = function() {
        this.openSet = [this.start];
        this.cameFrom.clear();
        this.closedSet = [];

        for (let row of this._arr) {
            for (let cell of row) {
                cell.gScore = Infinity;
                cell.fScore = 0;
            }
        }

        this.start.visited = true;
        this.start.gScore = 0;
    };
};


function Cell(x, y, h, id) {
    this.x = x;
    this.y = y;
    this.h = h;
    this.id = id;
    this.isObstacle = false;

    // in the simplest words this is the distance from the starting cell to the current cell
    this.gScore = Infinity;

    // the f-score decides where the code will go next
    // the f-score of a cell is the g-score of the cell + the distance to the destination
    // the lower the f-score, the better
    // so the f-score is a guess as to how close a cell is to the start as well as the end point
    this.fScore = 0;

    this.get_id = function() {
        return this.id;
    };

    // finds all the neighbors of the cell
    // Very inefficient I know 
    this.neighbors = function(grid) {
        let neighbors = [];
        if (this.x < grid.columns - 1)
            neighbors.push([grid.at(this.x + 1, this.y),1]); // 1 - a neighbor in the forward direction
        if (this.x > 0)
            neighbors.push([grid.at(this.x - 1, this.y),1]);
        if (this.y > 0)
            neighbors.push([grid.at(this.x, this.y - 1),1]);
        if (this.y < grid.rows - 1)
            neighbors.push([grid.at(this.x, this.y + 1),1]);
        if (this.y < grid.rows - 1 && this.x < grid.columns - 1)
            neighbors.push([grid.at(this.x + 1, this.y + 1),0]); // 0 - a neighbor in the diagonal direction
        if (this.y > 0 && this.x > 0)
            neighbors.push([grid.at(this.x - 1, this.y - 1),0]);
        if (this.y < grid.rows - 1 && this.x > 0)
            neighbors.push([grid.at(this.x - 1, this.y + 1),0]);
        if (this.y > 0 && this.x < grid.columns - 1)
            neighbors.push([grid.at(this.x + 1, this.y - 1),0]);

        return neighbors;
    };
};

function finish(current, cameFrom) {
    let res = [];
    //res.push(current);
    // this loop traces the path backwards
    // it finds from where the current cell came from and then further finds from where that cell came from
    while (cameFrom.get(current)) {
      res.push(current);
      current = cameFrom.get(current);
    }
    return res;
};

function a_star (grid, zoom){
	while (grid.openSet.length){
		// the cell with the lowest f-score 
		let current = grid.lowest_f();
		
		// if it is the destination cell, finish up
		if (current == grid.end){
			let res = finish(current, grid.cameFrom);
			res.push(grid.start);
			return res;
		}
		
		// else remove the current cell from the openSet and move to the set of analysed cells
		grid.openSet.remove(current);
		grid.closedSet.push(current);

		// iterate through the neighbor cell of the current cell
		for (let neighbor of current.neighbors(grid)){
			// if neighbor is the destination, end
			if (neighbor[0] == grid.end){
				let res = finish(current, grid.cameFrom);
                res.push(grid.start);
				return res;
			}

			// if the neighbor[0] is an obstacle or if it bas already been anayzed, skip this cell
			if (grid.closedSet.includes(neighbor[0]) || neighbor[0].isObstacle){
				continue;
			}

			// if neighbor[0] is not already in openSet add it
			if (!grid.openSet.includes(neighbor[0])){
				grid.openSet.push(neighbor[0]);
      }

			// as each cell has a distance of 1 unit, the next g-score will be the current g-score + 1
			let tentative_g = tentativeG(current, neighbor, grid, zoom);
        
			if (tentative_g >= neighbor[0].gScore){
				continue;
      }

			// link the neighbor to the current cell
			// when we are finding the final path, this will tell us where we went from the current cell
			grid.cameFrom.set(neighbor[0], current);
			// set the g-score
			neighbor[0].gScore = tentative_g;
			// as stated above, the f-score is the approx. distance from the start + the approx distance till the end
			neighbor[0].fScore = neighbor[0].gScore + heuristic(neighbor[0], grid.end, zoom, grid);
		}

	}
	
	return [];
};

export { Grid, a_star };

// grid = new Grid(columns,rows,[7,5],[11,7]);
// path = a_star(columns,rows, grid);

// for (let i=0; i<path.length; i++){
//     console.log(path[i]);
// }