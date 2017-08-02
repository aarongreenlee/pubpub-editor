import { getPlugin, keys } from './pluginKeys';

import { Plugin } from 'prosemirror-state';
import Promise from 'bluebird';
import { Slice } from 'prosemirror-model';
import firebase from 'firebase';
import { insertPoint } from 'prosemirror-transform';
import { schema } from '../schema';

const { Selection } = require('prosemirror-state')
const { Node } = require('prosemirror-model')
const { Step, Mapping } = require('prosemirror-transform')
const { collab, sendableSteps, receiveTransaction } = require('prosemirror-collab')
const { compressStepsLossy, compressStateJSON, uncompressStateJSON, compressSelectionJSON, uncompressSelectionJSON, compressStepJSON, uncompressStepJSON } = require('prosemirror-compress')
const TIMESTAMP = { '.sv': 'timestamp' }


const { DecorationSet, Decoration } = require('prosemirror-view');

function stringToColor(string, alpha = 1) {
    let hue = string.split('').reduce((sum, char) => sum + char.charCodeAt(0), 0) % 360
    return `hsla(${hue}, 100%, 50%, ${alpha})`
}

// Checkpoint a document every 100 steps
const SAVE_EVERY_N_STEPS = 100;


// how to implement forking:
// - create a new editor that forks & duplicates?


// healDatabase - In case a step corrupts the document (happens surpsiginly often), apply each step individually to find errors
// and then delete all of those steps
const healDatabase = ({ changesRef, steps, editor, placeholderClientId }) => {
  const stepsToDelete = [];
  for (const step of steps) {
    try {
      editor.dispatch(receiveTransaction(editor.state, step.steps, [placeholderClientId]));
    } catch (err) {
      stepsToDelete.push(step.key);
    }
  }

  for (const stepsToDelete of stepsToDelete) {
    changesRef.child(stepsToDelete).remove();
  }
};


const getSteps = ({view, changesRef, key}) => {

  function compressedStepJSONToStep(compressedStepJSON) {
    return Step.fromJSON(view.state.schema, uncompressStepJSON(compressedStepJSON)) }

  return new Promise((resolve, reject) => {

    changesRef.startAt(null, String(key + 1)).once('value').then(
      function (snapshot) {
        const changes = snapshot.val();
        if (!changes) {
          resolve([]);
        }
        const steps = [];
        const keys = Object.keys(changes);
        for (let key of keys) {
          const compressedStepsJSON = changes[key].s;
          steps.push(...compressedStepsJSON.map(compressedStepJSONToStep));
        }
        resolve(steps);
    });

  })
}

const getFirebaseValue = ({ref, child}) =>{
  return new Promise((resolve, reject) => {
    ref.child(child).once('value').then((snapshot) => {
      resolve(snapshot.val());
    })
  });
}

const setFirebaseValue = ({ ref, child, data }) =>{
  return new Promise((resolve, reject) => {
    ref.child(child).set(data, function(error) {
      if (!error) {
        resolve();
      } else {
        reject();
      }
    });
  });
}

const rebaseCommit = ({ commit, view, doc, allCommits, newSteps, changesRef, clientID, latestKey, selfChanges  }) => {

  function compressedStepJSONToStep(compressedStepJSON) {
    return Step.fromJSON(view.state.schema, uncompressStepJSON(compressedStepJSON)) }

  const docMapping = new Mapping();
  for (const step of newSteps) {
    docMapping.appendMap(step.getMap());
  }

  let tr = view.state.tr;

  const commitSteps = commit.steps;
  const previousSteps = [];


  for (const commit of allCommits) {
    for (const steps of Object.values(commit.steps)) {
      const compressedStepsJSON = steps.s;
      previousSteps.push(...compressedStepsJSON.map(compressedStepJSONToStep));
    }
  }

  for (const step of previousSteps) {
    const invertMap = step.getMap().invert();
    docMapping.appendMap(invertMap);
  }


  const allCommitSteps = [];
  Object.values(commitSteps).map((commitStep) => {

    const compressedStepsJSON = commitStep.s;
    allCommitSteps.push(...compressedStepsJSON.map(compressedStepJSONToStep));
  });

  console.log('commit steps', allCommitSteps);

  const mappedSteps = allCommitSteps.map((step) => {
    const mappedStep = step.map(docMapping);
    tr = tr.step(mappedStep);
    return mappedStep;
  });

  changesRef.child(latestKey + 1).transaction(
    function (existingBatchedSteps) {
      if (!existingBatchedSteps) {
        selfChanges[latestKey + 1] = mappedSteps
        return {
          s: compressStepsLossy(mappedSteps).map(
            function (step) {
              return compressStepJSON(step.toJSON()) } ),
          c: clientID, // need to store client id in rebase?
          m: { rebasedTransaction: true },
          t: TIMESTAMP,
        }
      }
    },
    function (error, committed, { key }) {
      if (error) {
        console.error('updateCollab', error, sendable, key)
      } else if (committed && key % SAVE_EVERY_N_STEPS === 0 && key > 0) {
        const { d } = compressStateJSON(newState.toJSON())
        checkpointRef.set({ d, k: key, t: TIMESTAMP })
      }
    },
    false );

  tr.setMeta('backdelete', true);
  tr.setMeta('rebase', true);
  view.dispatch(tr);

}

// use forkdoc as a starting point just to be absolutely sure?
const rebaseDocument = ({ view, doc, forkedSteps, newSteps, changesRef, clientID, latestKey,  selfChanges }) => {

  function compressedStepJSONToStep(compressedStepJSON) {
    return Step.fromJSON(view.state.schema, uncompressStepJSON(compressedStepJSON)) }

  const docMapping = new Mapping();
  for (const step of newSteps) {
    docMapping.appendMap(step.getMap());
  }

  let tr = view.state.tr;
  const mappedSteps = forkedSteps.map((step) => {
    const mappedStep = step.map(docMapping);
    tr = tr.step(mappedStep);
    return mappedStep;
  });

  changesRef.child(latestKey + 1).transaction(
    function (existingBatchedSteps) {
      if (!existingBatchedSteps) {
        selfChanges[latestKey + 1] = mappedSteps
        return {
          s: compressStepsLossy(mappedSteps).map(
            function (step) {
              return compressStepJSON(step.toJSON()) } ),
          c: clientID, // need to store client id in rebase?
          m: { rebasedTransaction: true },
          t: TIMESTAMP,
        }
      }
    },
    function (error, committed, { key }) {
      if (error) {
        console.error('updateCollab', error, sendable, key)
      } else if (committed && key % SAVE_EVERY_N_STEPS === 0 && key > 0) {
        const { d } = compressStateJSON(newState.toJSON())
        checkpointRef.set({ d, k: key, t: TIMESTAMP })
      }
    },
    false );

  tr.setMeta('backdelete', true);
  tr.setMeta('rebase', true);
  view.dispatch(tr);

}

let firebaseApp;

const FirebasePlugin = ({ selfClientID, editorKey, firebaseConfig, updateCommits }) => {

  if (!firebaseApp) {
    firebaseApp = firebase.initializeApp(firebaseConfig);
  }
  const db = firebase.database(firebaseApp);

  const collabEditing = require('prosemirror-collab').collab;
  const firebaseDb = firebase.database();
  const firebaseRef = firebaseDb.ref(editorKey);

  const checkpointRef  = firebaseRef.child('checkpoint');
  const changesRef = firebaseRef.child('changes');
  const selectionsRef = firebaseRef.child('selections');

  const selfSelectionRef = selectionsRef.child(selfClientID);
  selfSelectionRef.onDisconnect().remove();
  const selections = {};
  const selfChanges = {};
  let selection = undefined;
  let fetchedState = false;
  let latestKey;
  let selectionMarkers = {};
  let editorView;

  let loadingPromise = Promise.defer();

  const loadDocumentAndListen = (view) => {


    if (fetchedState) {
      return;
    }

    const commitIDRef = firebaseRef.child('currentCommit/commitID');
    const commitsRef = firebaseRef.child('commits');


    commitsRef.on('value', function(commitVals) {
      const commits = commitVals.val();
      if (!commits) {
        updateCommits([]);
        return;
      }
      updateCommits(Object.values(commits));
    });

    commitIDRef.on('value', function(commitVal) {
      const newCommitID = commitVal.val();
      const trackPlugin = getPlugin('track', editorView.state);
      if (trackPlugin) {
        trackPlugin.props.updateCommitID.bind(trackPlugin)(newCommitID);
      }
    });

    checkpointRef.once('value').then(
      function (snapshot) {
        // progress(1 / 2)
        let { d, k } = snapshot.val() || {}
        latestKey = k ? k : -1;
        latestKey = Number(latestKey)
        const newDoc = d && Node.fromJSON(view.state.schema, uncompressStateJSON({ d }).doc)

        function compressedStepJSONToStep(compressedStepJSON) {
          return Step.fromJSON(view.state.schema, uncompressStepJSON(compressedStepJSON)) }

        fetchedState = true;


        if (newDoc) {
          const { EditorState } = require('prosemirror-state');
      		const newState = EditorState.create({
      			doc: newDoc,
      			plugins: view.state.plugins,
      		});
      		view.updateState(newState);
        }


        return changesRef.startAt(null, String(latestKey + 1)).once('value').then(
          function (snapshot) {
            // progress(2 / 2)
            // const view = this_.view = constructView({ newDoc, updateCollab, selections })
            const editor = view

            const changes = snapshot.val()
            if (changes) {
              const steps = []
              const stepClientIDs = []
              const placeholderClientId = '_oldClient' + Math.random()
              const keys = Object.keys(changes)
              const stepsWithKeys = [];
              latestKey = Math.max(...keys)
              for (let key of keys) {
                const compressedStepsJSON = changes[key].s;
                const stepWithKey = {key, steps: compressedStepsJSON.map(compressedStepJSONToStep)};
                steps.push(...compressedStepsJSON.map(compressedStepJSONToStep));
                stepsWithKeys.push(stepWithKey);
                stepClientIDs.push(...new Array(compressedStepsJSON.length).fill(placeholderClientId))
              }
              try {
                const trans = receiveTransaction(editor.state, steps, stepClientIDs);
                trans.setMeta('receiveDoc', true);
                editor.dispatch(trans);
              } catch (err) {
                healDatabase({changesRef, editor, steps: stepsWithKeys, placeholderClientId});
              }

            }

            loadingPromise.resolve();

            function updateClientSelection(snapshot) {
              const clientID = snapshot.key
              if (clientID !== selfClientID) {
                const compressedSelection = snapshot.val()
                if (compressedSelection) {
                  try {
                    selections[clientID] = Selection.fromJSON(editor.state.doc, uncompressSelectionJSON(compressedSelection))
                  } catch (error) {
                    console.warn('updateClientSelection', error)
                  }
                } else {
                  delete selections[clientID]
                }
                editor.dispatch(editor.state.tr)
              }
            }
            selectionsRef.on('child_added', updateClientSelection)
            selectionsRef.on('child_changed', updateClientSelection)
            selectionsRef.on('child_removed', updateClientSelection)

            changesRef.startAt(null, String(latestKey + 1)).on(
              'child_added',
              function (snapshot) {
                latestKey = Number(snapshot.key)
                const { s: compressedStepsJSON, c: clientID, m: meta } = snapshot.val()
                const steps = (
                  clientID === selfClientID ?
                    selfChanges[latestKey]
                  :
                    compressedStepsJSON.map(compressedStepJSONToStep) )
                const stepClientIDs = new Array(steps.length).fill(clientID)
                const trans = receiveTransaction(editor.state, steps, stepClientIDs);
                if (meta) {
                  for (let metaKey in meta) {
                    trans.setMeta(metaKey, meta[metaKey]);
                  }
                }
                editor.dispatch(trans);
                delete selfChanges[latestKey]
              } )

            /*
            return Object.assign({
              destroy: this_.destroy.bind(this_),
            }, this_);
            */

          } )
      } );

  }



  return new Plugin({
  	state: {
  		init(config, instance) {

  			return { };
  		},
  		apply(transaction, state, prevEditorState, editorState) {

        if (transaction.docChanged) {
          for (let clientID in selections) {
            selections[clientID] = selections[clientID].map(editorState.doc, transaction.mapping);
          }
        }

        if (transaction.getMeta('pointer')) {
          selection = editorState.selection;
          selfSelectionRef.set(compressSelectionJSON(selection.toJSON()));
        }


  			return { };
  		}
  	},

    view: function(_editorView) {
  		editorView = _editorView;
  		loadDocumentAndListen(_editorView);
  		return {
  			update: (newView, prevState) => {
  				this.editorView = newView;
  			},
  			destroy: () => {
          editorView = null;
  				this.editorView = null;
  			}
  		}
  	},

  	props: {

      fork(forkID) {
        const editorRef = firebaseDb.ref(editorKey);
        return new Promise((resolve, reject) => {
          editorRef.once('value', function(snapshot) {
            const forkData = snapshot.val();
            forkData.currentCommit = { commitID: 1 };
            forkData.forkData = {
              merged: false,
              date: new Date(),
              parent: editorKey,
              forkedKey: latestKey,
            };
            forkData.forkDoc = compressStateJSON(editorView.state.toJSON());
            firebaseDb.ref(forkID).set(forkData, function(error) {
              if (!error) {
                editorRef.child('forks').child(forkID).set(true);
                resolve(forkID);
              } else {
                reject(error);
              }
            });
          });
        });
      },


      storeRebaseSteps(steps) {
        const editorRef = firebaseDb.ref(editorKey);
        const storedSteps =  {
          s: compressStepsLossy(steps).map(
            function (step) {
              return compressStepJSON(step.toJSON()) } ),
          c: selfClientID,
          m: {},
          t: TIMESTAMP,
        };
        editorRef.child('rebaseSteps').push().set(storedSteps);
        const lastCommit =  editorRef.child('currentCommit/steps').push().set(storedSteps);
      },

      // how to associate data with steps? Keep an id

      commit(description) {
        const editorRef = firebaseDb.ref(editorKey);

        return editorRef.child('currentCommit').once('value').then((snapshot) => {
          const currentCommit = snapshot.val();
          const commit = {
            description,
            clientID: '',
            steps: snapshot.val().steps,
            commitID: snapshot.val().commitID,
            merged: false,
          };
          return editorRef.child('commits').push().set(commit).then(() => {
            editorRef.child('currentCommit').set({commitID: Math.round(Math.random() * 100000)});
          });
        });
      },

      rebaseByCommit(forkID) {
        const forkRef = firebaseDb.ref(forkID);
        const editorChangesRef = firebaseDb.ref(editorKey).child("changes");

        return forkRef.child("forkData").once('value').then((snapshot) => {
          const { merged, parent, forkedKey } = snapshot.val();

          Promise.all([
            getFirebaseValue({ref: forkRef, child: "commits"}),
            getSteps({view: editorView, changesRef: editorChangesRef, key: forkedKey})
          ])
          .then(([commitVals, newSteps]) => {
            const commits = Object.values(commitVals || {});
            const singleCommit = commits[1];
            const prevCommits = [commits[0]];
            return rebaseCommit({ commit: singleCommit, allCommits: prevCommits, view: editorView, newSteps, changesRef, clientID: selfClientID, latestKey, selfChanges });
          })

        });

      },

      rebase(forkID) {
        return loadingPromise.promise.then(() => {
          return new Promise((resolve, reject) => {
            const forkRef = firebaseDb.ref(forkID);
            const forkedChangesRef = firebaseDb.ref(forkID).child("rebaseSteps");
            const editorChangesRef = firebaseDb.ref(editorKey).child("changes");
            const forkedDocRef = firebaseDb.ref(editorKey).child("forks").child(forkID);

            forkRef.child("forkData").once('value').then((snapshot) => {
              const { merged, parent, forkedKey } = snapshot.val();

              Promise.all([
                getFirebaseValue({ref: forkRef, child: "forkDoc"}),
                getSteps({view: editorView, changesRef: forkedChangesRef, key: null}),
                getSteps({view: editorView, changesRef: editorChangesRef, key: forkedKey})
              ])
              .then(([forkDoc, forkedSteps, newSteps]) => {
                return rebaseDocument({ view: editorView, doc: forkDoc, forkedSteps, newSteps, changesRef, clientID: selfClientID, latestKey, selfChanges });
              })
              .then(() => {
                return setFirebaseValue({ref: forkRef, child: "forkData/merged", data: true});
              })
              .then(() => {
                resolve();
              });

            });


          });
        });
      },

      getForks() {
        return loadingPromise.promise.then(() => {
          const forksKey = firebaseDb.ref(editorKey).child("forks");
          return getFirebaseValue({ref: firebaseDb.ref(editorKey), child: "forks"})
            .then((forkList) => {
              if (!forkList) {
                return [];
              }
              const forkNames = Object.keys(forkList);
              const getForkData = forkNames.map((forkName) => {
                return getFirebaseValue({ ref: firebaseDb.ref(forkName), child: "forkData" }).then((forkData) => {
                  forkData.name = forkName;
                  return forkData;
                });
              });
              return Promise.all(getForkData);
            });
        });
      },

      updateCollab({ docChanged, mapping, meta }, newState) {
        // return after meta pointer?
        if (meta.pointer) {
          delete(meta.pointer);
        }
        if (meta["collab$"]) {
          return;
        }
        if (meta.rebase) {
          delete(meta.rebase)
        }
        if (meta.addToHistory) {
          delete(meta.addToHistory)
        }
        const trackPlugin = getPlugin('track', editorView.state);

        const sendable = sendableSteps(newState);

        const updateRebasedSteps = () => {
          const rebasedSteps = trackPlugin.getSendableSteps();
          if (rebasedSteps) {
            this.props.storeRebaseSteps(rebasedSteps);
          }
        }

        // undo timeout?
        if (trackPlugin) {
          window.setTimeout(updateRebasedSteps, 0);
        }
        if (sendable) {
          const { steps, clientID } = sendable
          changesRef.child(latestKey + 1).transaction(
            function (existingBatchedSteps) {
              if (!existingBatchedSteps) {
                selfChanges[latestKey + 1] = steps
                return {
                  s: compressStepsLossy(steps).map(
                    function (step) {
                      return compressStepJSON(step.toJSON()) } ),
                  c: clientID,
                  m: meta,
                  t: TIMESTAMP,
                }
              }
            },
            function (error, committed, { key }) {
              if (error) {
                console.error('updateCollab', error, sendable, key)
              } else if (committed && key % SAVE_EVERY_N_STEPS === 0 && key > 0) {
                const { d } = compressStateJSON(newState.toJSON())
                checkpointRef.set({ d, k: key, t: TIMESTAMP })
              }
            },
            false )
        }

        // each selection changes only on 'pointer' transactions?

      },


  		decorations(state) {
        return DecorationSet.create(state.doc, Object.entries(selections).map(
          function ([ clientID, { from, to } ]) {
              if (clientID === selfClientID) {
                return null;
              }
              if (from === to) {
                  let elem = document.createElement('span')
                  elem.className = "collab-cursor";
                  elem.style.borderLeft = `1px solid ${stringToColor(clientID)}`
                  return Decoration.widget(from, elem)
              } else {
                  return Decoration.inline(from, to, {
                      style: `background-color: ${stringToColor(clientID, 0.2)};`,
                  })
              }
          }
        ));
  		},
  	},
    key: keys.firebase,
  });

}



export default FirebasePlugin;
