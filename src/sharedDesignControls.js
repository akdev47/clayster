/**
 * Mutations used by controls that are shared by the 2D and 3D views.
 * View mode and selection remain UI-only in the supplied editor controller.
 */
export class SharedDesignControls {
  constructor(model, editor) {
    this.model = model;
    this.editor = editor;
  }

  selectedElement() {
    return this.editor.selectedElement();
  }

  addElement(kind, source = {}, transform = {}) {
    const element = this.model.addElement({ kind, source, transform });
    this.editor.select(element.id);
    return element;
  }

  updateSelectedSource(kind, sourcePatch) {
    const selected = this.selectedElement();
    if (selected === null || selected.kind !== kind) return null;
    return this.model.updateElement(selected.id, { source: sourcePatch });
  }

  updateSelectedTransform(transformPatch) {
    const selected = this.selectedElement();
    if (selected === null) return null;
    return this.model.updateElement(selected.id, { transform: transformPatch });
  }

  replaceSelectedReference(kind, reference) {
    return this.updateSelectedSource(kind, { reference });
  }
}
