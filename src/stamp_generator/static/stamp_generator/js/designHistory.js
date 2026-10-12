// Undo / redo for the design elements.
//
// DesignModel keeps its elements as frozen, never-edited objects, so a
// snapshot is just a reference to the current array: recording history costs
// next to nothing and shares every unchanged element between steps.
//
// Only the design elements are tracked. Stamp settings (face size, relief and
// so on) live in the pipeline and are not part of undo.

const DEFAULT_LIMIT = 100;
const DEFAULT_MERGE_MS = 700;

export class DesignHistory extends EventTarget {
  #model;
  #limit;
  #mergeMs;
  #now;
  #undo = [];
  #redo = [];
  #current;
  #restoring = false;
  #lastEdit = { id: null, at: -Infinity };

  constructor(model, { limit = DEFAULT_LIMIT, mergeMs = DEFAULT_MERGE_MS, now = () => Date.now() } = {}) {
    super();
    this.#model = model;
    this.#limit = limit;
    this.#mergeMs = mergeMs;
    this.#now = now;
    this.#current = model.elements;
    model.addEventListener("change", () => this.#onChange());
  }

  get canUndo() {
    return this.#undo.length > 0;
  }

  get canRedo() {
    return this.#redo.length > 0;
  }

  undo() {
    if (!this.canUndo) return false;
    this.#redo.push(this.#current);
    this.#restore(this.#undo.pop());
    return true;
  }

  redo() {
    if (!this.canRedo) return false;
    this.#undo.push(this.#current);
    this.#restore(this.#redo.pop());
    return true;
  }

  /** Forgets all history, e.g. after loading a different design. */
  clear() {
    this.#undo = [];
    this.#redo = [];
    this.#current = this.#model.elements;
    this.#lastEdit = { id: null, at: -Infinity };
    this.#announce();
  }

  #restore(elements) {
    this.#restoring = true;
    try {
      this.#model.replaceElements(elements);
    } finally {
      this.#restoring = false;
    }
    this.#current = this.#model.elements;
    this.#lastEdit = { id: null, at: -Infinity };
    this.#announce();
  }

  #onChange() {
    if (this.#restoring) return;

    const before = this.#current;
    const after = this.#model.elements;
    this.#current = after;
    this.#redo = [];

    // A drag or a slider produces a burst of edits to one element. They count
    // as a single undo step while they keep arriving close together.
    const id = singleEditedId(before, after);
    const now = this.#now();
    const merge =
      id !== null && id === this.#lastEdit.id && now - this.#lastEdit.at <= this.#mergeMs;
    this.#lastEdit = { id, at: now };

    if (!merge) {
      this.#undo.push(before);
      if (this.#undo.length > this.#limit) this.#undo.shift();
    }
    this.#announce();
  }

  #announce() {
    this.dispatchEvent(new Event("change"));
  }
}

// The id of the one element that differs between two lists with the same
// elements in the same order, or null for any other kind of change.
function singleEditedId(before, after) {
  if (before.length !== after.length) return null;
  let id = null;
  for (let index = 0; index < before.length; index += 1) {
    if (before[index].id !== after[index].id) return null;
    if (before[index] !== after[index]) {
      if (id !== null) return null;
      id = after[index].id;
    }
  }
  return id;
}
