export type BoardCommand = "undo" | "redo" | "export:png" | "export:json";

export class BoardCommandBus {
  private target = new EventTarget();

  on(command: BoardCommand, handler: () => void): () => void {
    const fn: EventListener = () => handler();
    this.target.addEventListener(command, fn);
    return () => this.target.removeEventListener(command, fn);
  }

  emit(command: BoardCommand): void {
    this.target.dispatchEvent(new Event(command));
  }
}

