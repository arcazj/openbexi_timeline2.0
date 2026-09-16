import {generateTimeline} from '../engine.js';

// Generation runs off the main thread so large timelines leave the editor usable.
self.onmessage = async ({data: config}) => {
  try {
    const result = await generateTimeline(config);
    self.postMessage({ok: true, result});
  } catch (error) {
    self.postMessage({ok: false, error: {message: error.message, errors: error.errors ?? []}});
  }
};
