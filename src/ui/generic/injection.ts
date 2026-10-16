import type { InjectionInsertMethod } from '../../integrations/types';

export function insertElement(
  container: HTMLElement,
  target: HTMLElement,
  method: InjectionInsertMethod = 'insertAfter',
): void {
  switch (method) {
  case 'prepend':
    target.insertBefore(container, target.firstChild);
    return;
  case 'append':
    target.appendChild(container);
    return;
  case 'insertBefore':
    target.parentNode!.insertBefore(container, target);
    return;
  case 'insertAfter':
    target.parentNode!.insertBefore(container, target.nextSibling);
    return;
  case 'prependToSecondChild':
    target.children[1].insertBefore(container, target.children[1].firstChild);
    return;
  default: {
    const exhaustiveMethod: never = method;
    throw new Error(`Unsupported injection method: ${exhaustiveMethod}`);
  }
  }
}
