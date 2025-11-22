export interface SupergraphSettings {
	showAllFiles: boolean;
	showTags: boolean;
	showLinks: boolean;
	maxSnippetLength: number;
	minZoomForCards: number;
	enableManualEdges: boolean;
	fileFilter: string;
}

export const DEFAULT_SETTINGS: SupergraphSettings = {
	showAllFiles: true,
	showTags: true,
	showLinks: true,
	maxSnippetLength: 150,
	minZoomForCards: 0.5,
	enableManualEdges: true,
	fileFilter: ''
};
