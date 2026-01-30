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
        expect(['prepend', 'prependToSecondChild']).toContain(point.insertMethod);
      });
    });

    test('first injection point should be .bfsRGT with prepend method', () => {
      const firstPoint = WEALTHSIMPLE_UI.INJECTION_POINTS[0];
      expect(firstPoint.selector).toBe('.bfsRGT');
      expect(firstPoint.insertMethod).toBe('prepend');
    });

    test('second injection point should be .edYMHM with prependToSecondChild method', () => {
      const secondPoint = WEALTHSIMPLE_UI.INJECTION_POINTS[1];
      expect(secondPoint.selector).toBe('.edYMHM');
      expect(secondPoint.insertMethod).toBe('prependToSecondChild');
    });
  });

  describe('Injection point prioritization', () => {
    beforeEach(() => {
      // Clear DOM before each test
      document.body.innerHTML = '';
    });

    test('should find first injection point when available', () => {
      // Create both injection points
      const primaryContainer = document.createElement('div');
      primaryContainer.className = 'bfsRGT';
      document.body.appendChild(primaryContainer);

      const secondaryContainer = document.createElement('div');
      secondaryContainer.className = 'edYMHM';
      document.body.appendChild(secondaryContainer);

      // Verify primary is found first
      const found = document.querySelector(WEALTHSIMPLE_UI.INJECTION_POINTS[0].selector);
      expect(found).toBe(primaryContainer);
    });

    test('should fallback to second injection point when first is not available', () => {
      // Only create secondary injection point
      const secondaryContainer = document.createElement('div');
      secondaryContainer.className = 'edYMHM';
      document.body.appendChild(secondaryContainer);

      // Verify primary is not found
      const primaryFound = document.querySelector(WEALTHSIMPLE_UI.INJECTION_POINTS[0].selector);
      expect(primaryFound).toBeNull();

      // Verify secondary is found
      const secondaryFound = document.querySelector(WEALTHSIMPLE_UI.INJECTION_POINTS[1].selector);
      expect(secondaryFound).toBe(secondaryContainer);
    });

    test('should return null when no injection points are available', () => {
      // Don't create any injection points
      const found = WEALTHSIMPLE_UI.INJECTION_POINTS.map((ip) => document.querySelector(ip.selector)).find(
        (el) => el !== null,
      );
      expect(found).toBeUndefined();
    });
  });

  describe('prepend insert method', () => {
    beforeEach(() => {
      document.body.innerHTML = '';
    });

    test('should insert element as first child', () => {
      const container = document.createElement('div');
      container.className = 'bfsRGT';

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
      // <div class="edYMHM">
      //   <div id="first-child"></div>
      //   <div id="second-child">
      //     <div id="second-child-content"></div>
      //   </div>
      // </div>
      const container = document.createElement('div');
      container.className = 'edYMHM';

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
      container.className = 'edYMHM';

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
      container.className = 'edYMHM';
      document.body.appendChild(container);

      // No children
      const children = Array.from(container.children);
      expect(children.length).toBe(0);

      // Should not be able to get second child
      const targetContainer = children.length >= 2 ? children[1] : null;
      expect(targetContainer).toBeNull();
    });
  });

  describe('getAllInjectionSelectors helper', () => {
    test('should combine all selectors with comma separator', () => {
      const combinedSelector = WEALTHSIMPLE_UI.INJECTION_POINTS.map((ip) => ip.selector).join(', ');
      expect(combinedSelector).toBe('.bfsRGT, .edYMHM');
    });
  });
});
