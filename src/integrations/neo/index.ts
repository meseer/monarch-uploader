import * as monarchMapperNs from './sinks/monarch';

export { default as manifest } from './manifest';
export { createApi } from './source/api';
export { createAuth } from './source/auth';
export { default as injectionPoint } from './source/injectionPoint';
export const monarchMapper = monarchMapperNs;
export { default as syncHooks } from './sinks/monarch/syncHooks';
