declare module "rbush" {
  export type BBox = { minX: number; minY: number; maxX: number; maxY: number };

  export default class RBush<T extends BBox> {
    constructor(maxEntries?: number);
    all(): T[];
    clear(): this;
    insert(item: T): this;
    load(data: T[]): this;
    remove(item: T, equalsFn?: (a: T, b: T) => boolean): this;
    search(bbox: BBox): T[];
  }
}

