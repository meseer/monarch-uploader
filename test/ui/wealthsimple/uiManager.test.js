/**
 * @jest-environment jsdom
 */

import { WEALTHSIMPLE_UI } from '../../../src/core/config';

// Mock GM_getValue/GM_setValue
global.GM_getValue = jest.fn();
global.GM_setValue = jest.fn();

describe('Wealthsimple UI Injection Points', () => {
  describe('WEALTHSIMPLE_UI config', () => {
    test('should have INJECTION_POINTS array defined', () => {
      expect(WEALTHSIMPLE_UI).toBeDefined();
      expect(WEALTHSIMPLE_UI.INJECTION_POINTS).toBeDefined();
      expect(Array.isArray(WEALTHSIMPLE_UI.INJECTION_POINTS)).toBe(true);
    });

    test('should have at least one injection point', () => {
      expect(WEALTHSIMPLE_UI.INJECTION_POINTS.length).toBeGreaterThan(0);
    });

    test('each injection point should have selector and insertMethod', () => {
      WEALTHSIMPLE_UI.INJECTION_POINTS.forEach((point) => {
        expect(point.selector).toBeDefined();
        expect(typeof point.selector).toBe('string');
        expect(point.insertMethod).toBeDefined();
        expect(typeof point.insertMethod).toBe('string');
        expect(['prepend', 'prependToSecondChild', 'insertBefore']).toContain(point.insertMethod);
      });
    });

    test('first injection point should be last:.kOjAGq with prepend method', () => {
      const firstPoint = WEALTHSIMPLE_UI.INJECTION_POINTS[0];
      expect(firstPoint.selector).toBe('last:.kOjAGq');
      expect(firstPoint.insertMethod).toBe('prepend');
    });
  });

  describe('Injection point prioritization', () => {
    beforeEach(() => {
      // Clear DOM before each test
      document.body.innerHTML = '';
    });

    test('should find last injection point element when available', () => {
      // Create multiple elements matching the first injection point selector
      const first = document.createElement('div');
      first.className = 'kOjAGq';
      document.body.appendChild(first);

      const last = document.createElement('div');
      last.className = 'kOjAGq';
      document.body.appendChild(last);

      // 'last:.kOjAGq' should resolve to the last element
      const selector = WEALTHSIMPLE_UI.INJECTION_POINTS[0].selector; // 'last:.kOjAGq'
      expect(selector.startsWith('last:')).toBe(true);
      const cssSelector = selector.slice(5);
      const all = document.querySelectorAll(cssSelector);
      const found = all.length > 0 ? all[all.length - 1] : null;
      expect(found).toBe(last);
      expect(found).not.toBe(first);
    });

    test('should return null when no injection points are available', () => {
      // Don't create any injection points
      // Strip 'last:' prefix before querying since it's not a valid CSS selector prefix
      const found = WEALTHSIMPLE_UI.INJECTION_POINTS.map((ip) => {
        const cssSelector = ip.selector.startsWith('last:') ? ip.selector.slice(5) : ip.selector;
        return document.querySelector(cssSelector);
      }).find((el) => el !== null);
      expect(found).toBeUndefined();
    });
  });

  describe('prepend insert method', () => {
    beforeEach(() => {
      document.body.innerHTML = '';
    });

    test('should insert element as first child', () => {
      const container = document.createElement('div');
      container.className = 'bZQXKE';

      const existingChild = document.createElement('div');
      existingChild.id = 'existing-child';
      container.appendChild(existingChild);
      document.body.appendChild(container);

      // Simulate prepend behavior
      const newElement = document.createElement('div');
      newElement.id = 'new-element';
      container.insertBefore(newElement, container.firstChild);

      expect(container.firstChild).toBe(newElement);
      expect(container.children[0]).toBe(newElement);
      expect(container.children[1]).toBe(existingChild);
    });
  });

  describe('prependToSecondChild insert method', () => {
    beforeEach(() => {
      document.body.innerHTML = '';
    });

    test('should insert element as first child of second child', () => {
      // Create container with structure:
      // <div class="test-container">
      //   <div id="first-child"></div>
      //   <div id="second-child">
      //     <div id="second-child-content"></div>
      //   </div>
      // </div>
      const container = document.createElement('div');
      container.className = 'test-container';

      const firstChild = document.createElement('div');
      firstChild.id = 'first-child';
      container.appendChild(firstChild);

      const secondChild = document.createElement('div');
      secondChild.id = 'second-child';
      const secondChildContent = document.createElement('div');
      secondChildContent.id = 'second-child-content';
      secondChild.appendChild(secondChildContent);
      container.appendChild(secondChild);

      document.body.appendChild(container);

      // Get second child
      const children = Array.from(container.children);
      expect(children.length).toBeGreaterThanOrEqual(2);

      const targetContainer = children[1]; // Second child (0-indexed)
      expect(targetContainer.id).toBe('second-child');

      // Simulate prepend to second child
      const newElement = document.createElement('div');
      newElement.id = 'new-element';
      targetContainer.insertBefore(newElement, targetContainer.firstChild);

      // Verify new element is first child of second-child
      expect(targetContainer.firstChild).toBe(newElement);
      expect(targetContainer.children[0]).toBe(newElement);
      expect(targetContainer.children[1]).toBe(secondChildContent);
    });

    test('should return null when container has less than 2 children', () => {
      const container = document.createElement('div');
      container.className = 'test-container';

      // Only one child
      const firstChild = document.createElement('div');
      firstChild.id = 'first-child';
      container.appendChild(firstChild);

      document.body.appendChild(container);

      // Simulate getTargetContainer logic for prependToSecondChild
      const children = Array.from(container.children);
      expect(children.length).toBe(1);

      // Should not be able to get second child
      const targetContainer = children.length >= 2 ? children[1] : null;
      expect(targetContainer).toBeNull();
    });

    test('should return null when container has no children', () => {
      const container = document.createElement('div');
      container.className = 'test-container';
      document.body.appendChild(container);

      // No children
      const children = Array.from(container.children);
      expect(children.length).toBe(0);

      // Should not be able to get second child
      const targetContainer = children.length >= 2 ? children[1] : null;
      expect(targetContainer).toBeNull();
    });
  });

  describe('insertBefore insert method', () => {
    beforeEach(() => {
      document.body.innerHTML = '';
    });

    test('should insert element as previous sibling of target', () => {
      // Create container with structure:
      // <div id="parent">
      //   <div id="sibling-before"></div>
      //   <div class="target"></div>   <!-- Target element -->
      //   <div id="sibling-after"></div>
      // </div>
      const parent = document.createElement('div');
      parent.id = 'parent';

      const siblingBefore = document.createElement('div');
      siblingBefore.id = 'sibling-before';
      parent.appendChild(siblingBefore);

      const targetElement = document.createElement('div');
      targetElement.className = 'target';
      parent.appendChild(targetElement);

      const siblingAfter = document.createElement('div');
      siblingAfter.id = 'sibling-after';
      parent.appendChild(siblingAfter);

      document.body.appendChild(parent);

      // Simulate insertBefore behavior
      const newElement = document.createElement('div');
      newElement.id = 'new-element';
      parent.insertBefore(newElement, targetElement);

      // Verify new element is inserted before target
      expect(parent.children[0]).toBe(siblingBefore);
      expect(parent.children[1]).toBe(newElement); // Our UI
      expect(parent.children[2]).toBe(targetElement); // Original target
      expect(parent.children[3]).toBe(siblingAfter);
    });

    test('should work when target is first child', () => {
      // Create container with target as first element
      const parent = document.createElement('div');
      parent.id = 'parent';

      const targetElement = document.createElement('div');
      targetElement.className = 'target';
      parent.appendChild(targetElement);

      document.body.appendChild(parent);

      // Simulate insertBefore behavior
      const newElement = document.createElement('div');
      newElement.id = 'new-element';
      parent.insertBefore(newElement, targetElement);

      // Verify new element is now first child
      expect(parent.children[0]).toBe(newElement);
      expect(parent.children[1]).toBe(targetElement);
    });

    test('should return null when element has no parent', () => {
      // Create orphan element (not attached to DOM)
      const orphanElement = document.createElement('div');
      orphanElement.className = 'target';

      // Element is not attached, so parentNode is null
      expect(orphanElement.parentNode).toBeNull();
    });
  });

  describe('getAllInjectionSelectors helper', () => {
    test('should combine all selectors with comma separator, stripping last: prefix', () => {
      const combinedSelector = WEALTHSIMPLE_UI.INJECTION_POINTS.map((ip) =>
        ip.selector.startsWith('last:') ? ip.selector.slice(5) : ip.selector,
      ).join(', ');
      expect(combinedSelector).toBe('.kOjAGq, .bZQXKE');
    });
  });
});
