import { compressSelectionJSON, compressStateJSON, compressStepJSON, compressStepsLossy, uncompressSelectionJSON, uncompressStateJSON, uncompressStepJSON } from 'prosemirror-compress';


import { Node } from 'prosemirror-model';
import { Selection } from 'prosemirror-state';
import { Step } from 'prosemirror-transform';
import { receiveTransaction } from 'prosemirror-collab';

const TIMESTAMP = { '.sv': 'timestamp' };
const SAVE_EVERY_N_STEPS = 100;

class DocumentRef {
	constructor(firebaseRef, view, localClientId, localClientData) {
		this.ref = firebaseRef;
		this.view = view;
		this.latestKey = null;
		this.onClientChange = undefined;
		this.localClientId = localClientId;
		this.localClientData = localClientData;
		this.selections = {};
	}

	compressedStepJSONToStep = (compressedStepJSON) => {
		return Step.fromJSON(this.view.state.schema, uncompressStepJSON(compressedStepJSON));
	}

	getCheckpoint = (isFirstLoad) => {
		const checkpointRef = this.ref.child('checkpoint');
		return checkpointRef.once('value').then((snapshot) => {
			const { d, k } = snapshot.val() || {};
			let checkpointKey = k || 0;
			checkpointKey = Number(checkpointKey);
			const newDoc = d && Node.fromJSON(this.view.state.schema, uncompressStateJSON({ d }).doc);
			if (isFirstLoad) {
				this.latestKey = checkpointKey;
			}
			return { newDoc, checkpointKey };
		});
	}

	getChanges = (changesKey) => {
		const changesRef = this.ref.child('changes');

		return changesRef
		.startAt(null, String(changesKey))
		.once('value').then((snapshot) => {
			const changes = snapshot.val();
			if (changes) {
				const steps = [];
				const stepClientIDs = [];
				const placeholderClientId = `_oldClient${Math.random()}`;
				const keys = Object.keys(changes);
				const stepsWithKeys = [];
				this.latestKey = Math.max(...keys);

				for (const key of keys) {
					const compressedStepsJSON = changes[key].s;
					const uncompressedSteps = compressedStepsJSON.map(this.compressedStepJSONToStep);
					stepsWithKeys.push({ key, steps: uncompressedSteps });
					steps.push(...compressedStepsJSON.map(this.compressedStepJSONToStep));
					stepClientIDs.push(...new Array(compressedStepsJSON.length).fill(placeholderClientId));
				}
				return { steps, stepClientIDs, stepsWithKeys };
			}
			return { steps: null, stepClientIDs: null, stepsWithKeys: null };
		});
	}

	sendChanges = ({ steps, clientID, meta, newState, onStatusChange }) => {
		const changesRef = this.ref.child('changes');
		this.latestKey = this.latestKey + 1;

		return changesRef.child(this.latestKey).transaction(
			(existingBatchedSteps)=> {
				onStatusChange('saving');
				if (!existingBatchedSteps) {
					// selfChanges[latestKey + 1] = steps
					return {
						s: compressStepsLossy(steps)
						.map((step) => {
							return compressStepJSON(step.toJSON());
						}),
						c: clientID,
						m: meta,
						t: TIMESTAMP,
					};
				}
			},
			(error, committed, dataSnapshot)=> {
				if (!error) { onStatusChange('saved'); }
				const key = dataSnapshot ? dataSnapshot.key : undefined;
				if (error) {
					console.error('updateCollab', error, steps, clientID, key);
				} else if (committed && key % SAVE_EVERY_N_STEPS === 0 && key > 0) {
					this.updateCheckpoint(newState, key);
				}
			},
			false);
	}

	updateCheckpoint = (newState, key) => {
		const checkpointRef = this.ref.child('checkpoint');
		const { d } = compressStateJSON(newState.toJSON());
		checkpointRef.set({ d, k: key, t: TIMESTAMP });
	}

	listenToChanges = (onRemoteChange) => {
		const changesRef = this.ref.child('changes');

		changesRef.startAt(null, String(this.latestKey + 1))
		.on('child_added', (snapshot) => {
			this.latestKey = Number(snapshot.key);
			const { s: compressedStepsJSON, c: clientID, m: meta } = snapshot.val();
			const isLocal = (clientID === this.localClientId);
			if (isLocal) {
				onRemoteChange({ isLocal, meta, changeKey: this.latestKey });
			} else {
				const steps = compressedStepsJSON.map(this.compressedStepJSONToStep);
				const stepClientIDs = new Array(steps.length).fill(clientID);
				onRemoteChange({ steps, stepClientIDs, meta, changeKey: this.latestKey });
			}
		});
	}

	removeSelfSelection = ()=> {
		const selectionsRef = this.ref.child('selections');
		const selfSelectionRef = selectionsRef.child(this.localClientId);
		selfSelectionRef.remove();
	}

	listenToSelections = (onClientChange) => {
		const selectionsRef = this.ref.child('selections');

		const selfSelectionRef = selectionsRef.child(this.localClientId);
		selfSelectionRef.onDisconnect().remove();

		this.onClientChange = onClientChange;
		selectionsRef.on('child_added', this.addClientSelection);
		selectionsRef.on('child_changed', this.updateClientSelection);
		selectionsRef.on('child_removed', this.deleteClientSelection);
	}

	issueEmptyTransaction = () => {
		this.view.dispatch(this.view.state.tr);
	}


	updateClientSelection = (snapshot) => {
		const clientID = snapshot.key;
		if (clientID !== this.localClientId) {
			const compressedSelection = snapshot.val();
			if (compressedSelection) {
				try {
					/* Sometimes, because the selection syncs before the doc, the */
					/* selection location is larger than the doc size. */
					/* Math.min the anchor and head to prevent this from being an issue */
					const docSize = this.view.state.doc.content.size;
					const correctedSelection = uncompressSelectionJSON(compressedSelection);
					correctedSelection.anchor = Math.min(docSize, correctedSelection.anchor);
					correctedSelection.head = Math.min(docSize, correctedSelection.head);
					this.selections[clientID] = Selection.fromJSON(this.view.state.doc, correctedSelection);
					this.selections[clientID].data = compressedSelection.data;
				} catch (error) {
					console.warn('updateClientSelection', error);
				}
			} else {
				delete this.selections[clientID];
			}
			this.issueEmptyTransaction();
		}
	}


	deleteClientSelection = (snapshot) => {
		const clientID = snapshot.key;
		delete this.selections[clientID];
		if (this.onClientChange) {
			this.onClientChange(Object.keys(this.selections).map((key)=> {
				return this.selections[key].data;
			}));
		}
		this.issueEmptyTransaction();
	}

	addClientSelection = (snapshot) => {
		this.updateClientSelection(snapshot);
		if (this.onClientChange) {
			this.onClientChange(Object.keys(this.selections).map((key)=> {
				return this.selections[key].data;
			}));
		}
	}

	setSelection = (selection) => {
		const selectionsRef = this.ref.child('selections');
		const selfSelectionRef = selectionsRef.child(this.localClientId);
		const compressed = compressSelectionJSON(selection.toJSON());
		compressed.data = this.localClientData;
		// compressed.data.lastActive has to be rounded to the nearest minute (or some larger value)
		// If it is updated every millisecond, firebase will see it as constant changes
		// And you'll get a loop of updates triggering millisecond updates.
		// - The lastActive is updated anytime a client makes or receives changes.
		// A client will be active even if they have a tab open and are 'watching'. 
		const smoothingTimeFactor = 1000 * 60;
		compressed.data.lastActive = Math.round(new Date().getTime() / smoothingTimeFactor) * smoothingTimeFactor;
		return selfSelectionRef.set(compressed);
	}

	removeStaleSelections = ()=> {
		for (const clientId in this.selections) {
			const originalClientData = this.selections[clientId].data || {};
			const expirationTime = (1000 * 60 * 10); // 10 Minutes
			if (!originalClientData.lastActive ||
				(originalClientData.lastActive + expirationTime) < new Date().getTime()
			) {
				const selectionsRef = this.ref.child('selections');
				const clientSelectionRef = selectionsRef.child(clientId);
				clientSelectionRef.remove();
			}
		}
	}

	mapSelection = (transaction, editorState) => {
		for (const clientId in this.selections) {
			const originalClientData = this.selections[clientId].data || {};
			this.selections[clientId] = this.selections[clientId].map(editorState.doc, transaction.mapping);
			this.selections[clientId].data = originalClientData;
		}
	}

	// healDatabase - In case a step corrupts the document (happens surpsiginly often),
	// apply each step individually to find errors
	// and then delete all of those steps
	healDatabase = ({ stepsWithKeys, view }) => {
		const stepsToDelete = [];
		const placeholderClientId = `_oldClient${Math.random()}`;
		// const changesRef = this.ref.child('changes');

		console.error('Healing database', stepsWithKeys);
		stepsWithKeys.forEach((step)=> {
			try {
				const trans = receiveTransaction(view.state, step.steps, [placeholderClientId]);
				trans.setMeta('receiveDoc', true);
				view.dispatch(trans);
			} catch (err) {
				console.log('StepError is ', err);
				stepsToDelete.push(step.key);
			}
		});

		stepsToDelete.forEach((stepToDelete)=> {
			/* Perhaps we can just skip the step rather   */
			/* than deleting it. That way we can debug it */
			/* if a document seems to have funky errors   */
			console.log('Skipping Step ', stepToDelete);
			// changesRef.child(stepToDelete).remove();
		});
	}

	copyDataForFork = (editorKey) => {
		const editorRef = this.ref;
		return editorRef.once('value').then((snapshot) => {
			const fork = snapshot.val();
			fork.currentCommit = { commitID: 0 };
			fork.forkMeta = {
				merged: false,
				date: new Date(),
				parent: editorKey,
				forkedKey: this.latestKey,
			};
			fork.changes = [];
			fork.forks = [];
			fork.selections = [];

			const { d } = compressStateJSON(this.view.state.toJSON());
			fork.checkpoint = { d, k: 0, t: TIMESTAMP };

			return fork;
		});
	}

	getForks = () => {
		return this.ref.child('forks').once('value')
		.then((snapshot) => {
			const forkList = snapshot.val();
			if (!forkList) {
				return [];
			}
			const forkNames = Object.keys(forkList);
			return forkNames.map((forkName) => {
				return forkName;
			});
		});
	}

	commit = ({ description, uuid, steps, start, end }) => {
		const editorRef = this.ref;

		const commitSteps = {
			s: compressStepsLossy(steps).map((step)=> {
				return compressStepJSON(step.toJSON());
			}),
			c: this.localClientId,
			m: {},
			t: TIMESTAMP,
		};
		return editorRef.child('currentCommit').once('value').then((snapshot) => {
			const currentCommit = snapshot.val();
			const commitID = currentCommit.commitID;
			const commit = {
				description,
				clientID: '',
				steps: [commitSteps],
				uuid: uuid,
				merged: false,
				commitKey: this.latestKey,
				start,
				end
			};
			const newCommitID = commitID + 1;
			return editorRef.child(`commits/${commitID}`).set(commit).then(() => {
				editorRef.child('currentCommit').set({ commitID: newCommitID });
				// const { d } = compressStateJSON(editorView.state.toJSON());
				// checkpointRef.set({ d, k: latestKey, t: TIMESTAMP });
			});
		});
	}
}

export default DocumentRef;
