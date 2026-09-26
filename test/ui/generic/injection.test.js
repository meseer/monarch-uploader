import { insertElement } from '../../../src/ui/generic/injection';

describe('generic UI insertion methods', () => {
  function element(tagName = 'div') {
    return document.createElement(tagName);
  }

  it('prepends the container inside the target', () => {
    const target = element();
    const existing = element();
    const container = element();
    target.append(existing);

    insertElement(container, target, 'prepend');

    expect(target.firstChild).toBe(container);
  });

  it('appends the container inside the target', () => {
    const target = element();
    const existing = element();
    const container = element();
    target.append(existing);

    insertElement(container, target, 'append');

    expect(target.lastChild).toBe(container);
  });

  it('inserts the container before a target sibling', () => {
    const parent = element();
    const target = element();
    const container = element();
    parent.append(target);

    insertElement(container, target, 'insertBefore');

    expect(parent.firstChild).toBe(container);
    expect(parent.lastChild).toBe(target);
  });

  it('inserts the container after a target sibling', () => {
    const parent = element();
    const target = element();
    const container = element();
    parent.append(target);

    insertElement(container, target, 'insertAfter');

    expect(parent.firstChild).toBe(target);
    expect(parent.lastChild).toBe(container);
  });

  it('defaults to inserting after the target', () => {
    const parent = element();
    const target = element();
    const container = element();
    parent.append(target);

    insertElement(container, target);

    expect(parent.lastChild).toBe(container);
  });

  it('prepends into the target second child', () => {
    const target = element();
    const firstChild = element();
    const secondChild = element();
    const existing = element();
    const container = element();
    target.append(firstChild, secondChild);
    secondChild.append(existing);

    insertElement(container, target, 'prependToSecondChild');

    expect(secondChild.firstChild).toBe(container);
  });
});
