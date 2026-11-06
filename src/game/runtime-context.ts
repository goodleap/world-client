/** Browser-only facts are injected before constructing a worker scene. */
export interface RuntimeContext {
  baseURI:string; search:string; storage:Pick<Storage,'getItem'|'setItem'>;
}
let injected:RuntimeContext|undefined;
export function setRuntimeContext(value:RuntimeContext){injected=value;}
export function runtimeContext():RuntimeContext{
  return injected??{baseURI:document.baseURI,search:location.search,storage:localStorage};
}
