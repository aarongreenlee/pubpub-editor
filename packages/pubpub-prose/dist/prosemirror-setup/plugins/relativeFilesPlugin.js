'use strict';

Object.defineProperty(exports, "__esModule", {
	value: true
});

var _prosemirrorState = require('prosemirror-state');

var _pluginKeys = require('./pluginKeys');

// import { Decoration, DecorationSet } from 'prosemirror-view';
var RelativeFilesPlugin = new _prosemirrorState.Plugin({
	state: {
		init: function init(config, instance) {
			console.log('GOT FILEMAP', config.fileMap);
			return { fileMap: config.fileMap || {} };
		},
		apply: function apply(transaction, state, prevEditorState, editorState) {
			var uploadedFile = void 0;
			if (uploadedFile = transaction.getMeta('uploadedFile')) {
				var fileMap = state.fileMap;
				fileMap[uploadedFile.filename] = uploadedFile.url;
				return { fileMap: fileMap };
			}
			return state;
		}
	},
	props: {
		getFile: function getFile(_ref) {
			var filename = _ref.filename,
			    state = _ref.state;

			var pluginState = void 0;
			if (pluginState = state && this.getState(state)) {
				var file = pluginState.fileMap[filename];
				return file;
			}
			return null;
		},
		getAllFiles: function getAllFiles(_ref2) {
			var state = _ref2.state;

			var pluginState = void 0;
			if (pluginState = state && this.getState(state)) {
				var files = pluginState.fileMap;
				return files;
			}
			return null;
		}
	},
	key: _pluginKeys.keys.relativefiles
});

exports.default = RelativeFilesPlugin;