export interface NodePosition {
	x: number;
	y: number;
}

export interface GraphNode {
	id: string;
	label: string;
	snippet: string;
	position?: NodePosition;
}

export interface GraphEdge {
	id: string;
	source: string;
	target: string;
	isManual?: boolean;
}

export interface GraphState {
	nodes: GraphNode[];
	edges: GraphEdge[];
	zoom: number;
	pan: { x: number; y: number };
}
