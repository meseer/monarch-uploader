/**
 * Tests for Keyboard Navigation Utilities
 */

import {
  addModalKeyboardHandlers,
  makeItemsKeyboardNavigable,
  addButtonKeyboardHandlers,
  trapFocus,
} from '../../src/ui/keyboardNavigation';

describe('Keyboard Navigation Utilities', () => {
  let container;

  beforeEach(() => {
    // Create a container element for our tests
    container = document.createElement('div');
    document.body.appendChild(container);
  });

  afterEach(() => {
    // Clean up DOM after each test
    if (container.parentNode) {
      container.parentNode.removeChild(container);
    }
  });

  describe('addModalKeyboardHandlers', () => {
    let overlay;
    let onEscape;
    let onEnter;
    let cleanup;

    beforeEach(() => {
      overlay = document.createElement('div');
      onEscape = jest.fn();
      onEnter = jest.fn();
      container.appendChild(overlay);
    });

    afterEach(() => {
      if (cleanup) cleanup();
    });

    test('should call onEscape when Escape key is pressed', () => {
      cleanup = addModalKeyboardHandlers(overlay, onEscape, onEnter);

      const event = new KeyboardEvent('keydown', { key: 'Escape' });
      overlay.dispatchEvent(event);

      expect(onEscape).toHaveBeenCalledTimes(1);
    });

    test('should call onEnter when Enter key is pressed on non-input element', () => {
      cleanup = addModalKeyboardHandlers(overlay, onEscape, onEnter);

      const event = new KeyboardEvent('keydown', { key: 'Enter' });
      overlay.dispatchEvent(event);

      expect(onEnter).toHaveBeenCalledTimes(1);
    });

    test('should not call onEnter when Enter key is pressed on input element', () => {
      cleanup = addModalKeyboardHandlers(overlay, onEscape, onEnter);

      const input = document.createElement('input');
      overlay.appendChild(input);

      const event = new KeyboardEvent('keydown', { key: 'Enter' });
      Object.defineProperty(event, 'target', { value: input, configurable: true });
      overlay.dispatchEvent(event);

      expect(onEnter).not.toHaveBeenCalled();
    });

    test('should not call onEnter when Enter key is pressed on textarea', () => {
      cleanup = addModalKeyboardHandlers(overlay, onEscape, onEnter);

      const textarea = document.createElement('textarea');
      overlay.appendChild(textarea);

      const event = new KeyboardEvent('keydown', { key: 'Enter' });
      Object.defineProperty(event, 'target', { value: textarea, configurable: true });
      overlay.dispatchEvent(event);

      expect(onEnter).not.toHaveBeenCalled();
    });

    test('should not call onEnter when Enter key is pressed on contentEditable element', () => {
      cleanup = addModalKeyboardHandlers(overlay, onEscape, onEnter);

      const div = document.createElement('div');
      div.contentEditable = 'true';
      overlay.appendChild(div);

      const event = new KeyboardEvent('keydown', { key: 'Enter' });
      Object.defineProperty(event, 'target', { value: div, configurable: true });
      overlay.dispatchEvent(event);

      expect(onEnter).not.toHaveBeenCalled();
    });

    test('should work without onEnter callback', () => {
      cleanup = addModalKeyboardHandlers(overlay, onEscape);

      const event = new KeyboardEvent('keydown', { key: 'Enter' });
      overlay.dispatchEvent(event);

      // Should not throw error
      expect(onEscape).not.toHaveBeenCalled();
    });

    test('should ignore other keys', () => {
      cleanup = addModalKeyboardHandlers(overlay, onEscape, onEnter);

      const event = new KeyboardEvent('keydown', { key: 'Tab' });
      overlay.dispatchEvent(event);

      expect(onEscape).not.toHaveBeenCalled();
      expect(onEnter).not.toHaveBeenCalled();
    });

    test('should prevent default and stop propagation for Escape', () => {
      cleanup = addModalKeyboardHandlers(overlay, onEscape, onEnter);

      const event = new KeyboardEvent('keydown', { key: 'Escape' });
      event.preventDefault = jest.fn();
      event.stopPropagation = jest.fn();
      overlay.dispatchEvent(event);

      expect(event.preventDefault).toHaveBeenCalled();
      expect(event.stopPropagation).toHaveBeenCalled();
    });

    test('should prevent default and stop propagation for Enter on non-input', () => {
      cleanup = addModalKeyboardHandlers(overlay, onEscape, onEnter);

      const event = new KeyboardEvent('keydown', { key: 'Enter' });
      event.preventDefault = jest.fn();
      event.stopPropagation = jest.fn();
      overlay.dispatchEvent(event);

      expect(event.preventDefault).toHaveBeenCalled();
      expect(event.stopPropagation).toHaveBeenCalled();
    });

    test('cleanup function should remove event listeners', () => {
      cleanup = addModalKeyboardHandlers(overlay, onEscape, onEnter);

      // Cleanup
      cleanup();

      // Events should no longer trigger callbacks
      const event = new KeyboardEvent('keydown', { key: 'Escape' });
      overlay.dispatchEvent(event);

      expect(onEscape).not.toHaveBeenCalled();
    });
  });

  describe('makeItemsKeyboardNavigable', () => {
    let items;
    let onSelect;
    let cleanup;

    beforeEach(() => {
      onSelect = jest.fn();
      items = [];
      for (let i = 0; i < 3; i++) {
        const item = document.createElement('div');
        item.textContent = `Item ${i}`;
        items.push(item);
        container.appendChild(item);
      }
    });

    afterEach(() => {
      if (cleanup) cleanup();
    });

    test('should return empty cleanup function for empty items array', () => {
      cleanup = makeItemsKeyboardNavigable([], onSelect);
      expect(typeof cleanup).toBe('function');
      cleanup(); // Should not throw
    });

    test('should return empty cleanup function for null items', () => {
      cleanup = makeItemsKeyboardNavigable(null, onSelect);
      expect(typeof cleanup).toBe('function');
      cleanup(); // Should not throw
    });

    test('should set initial focus on first item by default', (done) => {
      cleanup = makeItemsKeyboardNavigable(items, onSelect);

      // Use setTimeout to wait for the async focus
      setTimeout(() => {
        expect(items[0].getAttribute('tabindex')).toBe('0');
        expect(items[1].getAttribute('tabindex')).toBe('-1');
        expect(items[2].getAttribute('tabindex')).toBe('-1');
        done();
      }, 10);
    });

    test('should set initial focus on specified item', (done) => {
      cleanup = makeItemsKeyboardNavigable(items, onSelect, 1);

      setTimeout(() => {
        expect(items[0].getAttribute('tabindex')).toBe('-1');
        expect(items[1].getAttribute('tabindex')).toBe('0');
        expect(items[2].getAttribute('tabindex')).toBe('-1');
        done();
      }, 10);
    });

    test('should handle initial focus index out of bounds', (done) => {
      cleanup = makeItemsKeyboardNavigable(items, onSelect, 10);

      setTimeout(() => {
        expect(items[2].getAttribute('tabindex')).toBe('0'); // Should focus last item
        done();
      }, 10);
    });

    test('should handle negative initial focus index', (done) => {
      cleanup = makeItemsKeyboardNavigable(items, onSelect, -1);

      setTimeout(() => {
        expect(items[0].getAttribute('tabindex')).toBe('0'); // Should focus first item
        done();
      }, 10);
    });

    test('should move focus down on ArrowDown', () => {
      cleanup = makeItemsKeyboardNavigable(items, onSelect, 0);

      const event = new KeyboardEvent('keydown', { key: 'ArrowDown' });
      event.preventDefault = jest.fn();

      // Mock focus to simulate JSDOM behavior
      const originalFocus = items[1].focus;
      items[1].focus = jest.fn();

      items[0].dispatchEvent(event);

      expect(event.preventDefault).toHaveBeenCalled();
      expect(items[1].focus).toHaveBeenCalled();

      // Restore original focus
      items[1].focus = originalFocus;
    });

    test('should move focus up on ArrowUp', () => {
      cleanup = makeItemsKeyboardNavigable(items, onSelect, 1);

      const event = new KeyboardEvent('keydown', { key: 'ArrowUp' });
      event.preventDefault = jest.fn();

      // Mock focus to simulate JSDOM behavior
      const originalFocus = items[0].focus;
      items[0].focus = jest.fn();

      items[1].dispatchEvent(event);

      expect(event.preventDefault).toHaveBeenCalled();
      expect(items[0].focus).toHaveBeenCalled();

      // Restore original focus
      items[0].focus = originalFocus;
    });

    test('should not move focus beyond first item on ArrowUp', () => {
      cleanup = makeItemsKeyboardNavigable(items, onSelect, 0);

      const event = new KeyboardEvent('keydown', { key: 'ArrowUp' });
      event.preventDefault = jest.fn();

      // Mock focus to ensure it's not called on any other items
      items[1].focus = jest.fn();
      items[2].focus = jest.fn();

      items[0].dispatchEvent(event);

      expect(event.preventDefault).toHaveBeenCalled();
      // Should not call focus on other items
      expect(items[1].focus).not.toHaveBeenCalled();
      expect(items[2].focus).not.toHaveBeenCalled();
    });

    test('should not move focus beyond last item on ArrowDown', () => {
      cleanup = makeItemsKeyboardNavigable(items, onSelect, 2);

      const event = new KeyboardEvent('keydown', { key: 'ArrowDown' });
      event.preventDefault = jest.fn();

      // Mock focus to ensure it's not called on any other items
      items[0].focus = jest.fn();
      items[1].focus = jest.fn();

      items[2].dispatchEvent(event);

      expect(event.preventDefault).toHaveBeenCalled();
      // Should not call focus on other items
      expect(items[0].focus).not.toHaveBeenCalled();
      expect(items[1].focus).not.toHaveBeenCalled();
    });

    test('should call onSelect when Enter is pressed', () => {
      cleanup = makeItemsKeyboardNavigable(items, onSelect, 0);

      const event = new KeyboardEvent('keydown', { key: 'Enter' });
      event.preventDefault = jest.fn();
      event.stopPropagation = jest.fn();
      items[0].dispatchEvent(event);

      expect(event.preventDefault).toHaveBeenCalled();
      expect(event.stopPropagation).toHaveBeenCalled();
      expect(onSelect).toHaveBeenCalledWith(items[0], 0);
    });

    test('should call onSelect when Space is pressed', () => {
      cleanup = makeItemsKeyboardNavigable(items, onSelect, 1);

      const event = new KeyboardEvent('keydown', { key: ' ' });
      event.preventDefault = jest.fn();
      event.stopPropagation = jest.fn();
      items[1].dispatchEvent(event);

      expect(event.preventDefault).toHaveBeenCalled();
      expect(event.stopPropagation).toHaveBeenCalled();
      expect(onSelect).toHaveBeenCalledWith(items[1], 1);
    });

    test('should handle Tab key navigation', () => {
      cleanup = makeItemsKeyboardNavigable(items, onSelect, 0);

      // Mock focus for Tab forward
      const originalFocus1 = items[1].focus;
      items[1].focus = jest.fn();

      const tabEvent = new KeyboardEvent('keydown', { key: 'Tab' });
      items[0].dispatchEvent(tabEvent);

      expect(items[1].focus).toHaveBeenCalled();

      // Mock focus for Shift+Tab backward
      const originalFocus0 = items[0].focus;
      items[0].focus = jest.fn();

      const shiftTabEvent = new KeyboardEvent('keydown', { key: 'Tab', shiftKey: true });
      items[1].dispatchEvent(shiftTabEvent);

      expect(items[0].focus).toHaveBeenCalled();

      // Restore original focus methods
      items[0].focus = originalFocus0;
      items[1].focus = originalFocus1;
    });

    test('should update tabindex on focus', () => {
      cleanup = makeItemsKeyboardNavigable(items, onSelect, 0);

      // Simulate focus on second item
      items[1].focus();
      items[1].dispatchEvent(new Event('focus'));

      expect(items[0].getAttribute('tabindex')).toBe('-1');
      expect(items[1].getAttribute('tabindex')).toBe('0');
      expect(items[2].getAttribute('tabindex')).toBe('-1');
    });

    test('should add focus styling on focus', () => {
      cleanup = makeItemsKeyboardNavigable(items, onSelect, 0);

      items[0].dispatchEvent(new Event('focus'));
      expect(items[0].style.boxShadow).toBe('0 0 0 2px #007bff');
    });

    test('should remove focus styling on blur', () => {
      cleanup = makeItemsKeyboardNavigable(items, onSelect, 0);

      items[0].style.boxShadow = '0 0 0 2px #007bff';
      items[0].dispatchEvent(new Event('blur'));
      expect(items[0].style.boxShadow).toBe('');
    });

    test('should preserve existing tabindex', () => {
      items[1].setAttribute('tabindex', '5');
      cleanup = makeItemsKeyboardNavigable(items, onSelect, 1);

      expect(items[1].getAttribute('tabindex')).toBe('0'); // Should be overridden for focus management
    });

    test('should set outline style to none', () => {
      cleanup = makeItemsKeyboardNavigable(items, onSelect);

      items.forEach((item) => {
        expect(item.style.outline).toBe('none');
      });
    });

    test('cleanup function should remove all event listeners', () => {
      cleanup = makeItemsKeyboardNavigable(items, onSelect, 0);

      // Cleanup
      cleanup();

      // Events should no longer trigger
      const event = new KeyboardEvent('keydown', { key: 'Enter' });
      items[0].dispatchEvent(event);

      expect(onSelect).not.toHaveBeenCalled();
    });
  });

  describe('addButtonKeyboardHandlers', () => {
    let buttons;
    let onActivate;
    let cleanup;

    beforeEach(() => {
      onActivate = jest.fn();
      buttons = [];
      for (let i = 0; i < 3; i++) {
        const button = document.createElement('button');
        button.textContent = `Button ${i}`;
        buttons.push(button);
        container.appendChild(button);
      }
    });

    afterEach(() => {
      if (cleanup) cleanup();
    });

    test('should call onActivate when Enter is pressed', () => {
      cleanup = addButtonKeyboardHandlers(buttons, onActivate);

      const event = new KeyboardEvent('keydown', { key: 'Enter' });
      event.preventDefault = jest.fn();
      event.stopPropagation = jest.fn();
      buttons[0].dispatchEvent(event);

      expect(event.preventDefault).toHaveBeenCalled();
      expect(event.stopPropagation).toHaveBeenCalled();
      expect(onActivate).toHaveBeenCalledWith(buttons[0]);
    });

    test('should call onActivate when Space is pressed', () => {
      cleanup = addButtonKeyboardHandlers(buttons, onActivate);

      const event = new KeyboardEvent('keydown', { key: ' ' });
      event.preventDefault = jest.fn();
      event.stopPropagation = jest.fn();
      buttons[1].dispatchEvent(event);

      expect(event.preventDefault).toHaveBeenCalled();
      expect(event.stopPropagation).toHaveBeenCalled();
      expect(onActivate).toHaveBeenCalledWith(buttons[1]);
    });

    test('should not call onActivate for other keys', () => {
      cleanup = addButtonKeyboardHandlers(buttons, onActivate);

      const event = new KeyboardEvent('keydown', { key: 'Tab' });
      buttons[0].dispatchEvent(event);

      expect(onActivate).not.toHaveBeenCalled();
    });

    test('should work without onActivate callback', () => {
      cleanup = addButtonKeyboardHandlers(buttons, null);

      const event = new KeyboardEvent('keydown', { key: 'Enter' });
      buttons[0].dispatchEvent(event);

      // Should not throw error
      expect(true).toBe(true);
    });

    test('cleanup function should remove event listeners', () => {
      cleanup = addButtonKeyboardHandlers(buttons, onActivate);

      // Cleanup
      cleanup();

      // Events should no longer trigger callbacks
      const event = new KeyboardEvent('keydown', { key: 'Enter' });
      buttons[0].dispatchEvent(event);

      expect(onActivate).not.toHaveBeenCalled();
    });
  });

  describe('trapFocus', () => {
    let focusContainer;
    let firstButton;
    let middleButton;
    let lastButton;
    let cleanup;

    beforeEach(() => {
      focusContainer = document.createElement('div');
      firstButton = document.createElement('button');
      middleButton = document.createElement('button');
      lastButton = document.createElement('button');

      firstButton.textContent = 'First';
      middleButton.textContent = 'Middle';
      lastButton.textContent = 'Last';

      focusContainer.appendChild(firstButton);
      focusContainer.appendChild(middleButton);
      focusContainer.appendChild(lastButton);
      container.appendChild(focusContainer);
    });

    afterEach(() => {
      if (cleanup) cleanup();
    });

    test('should trap focus from last to first element on Tab', () => {
      cleanup = trapFocus(focusContainer);

      // Mock focus method to track calls
      const originalFocus = firstButton.focus;
      firstButton.focus = jest.fn();

      const event = new KeyboardEvent('keydown', { key: 'Tab' });
      event.preventDefault = jest.fn();
      Object.defineProperty(document, 'activeElement', { value: lastButton, configurable: true });

      focusContainer.dispatchEvent(event);

      expect(event.preventDefault).toHaveBeenCalled();
      expect(firstButton.focus).toHaveBeenCalled();

      // Restore original focus
      firstButton.focus = originalFocus;
    });

    test('should trap focus from first to last element on Shift+Tab', () => {
      cleanup = trapFocus(focusContainer);

      // Mock focus method to track calls
      const originalFocus = lastButton.focus;
      lastButton.focus = jest.fn();

      const event = new KeyboardEvent('keydown', { key: 'Tab', shiftKey: true });
      event.preventDefault = jest.fn();

      // Mock document.activeElement to return firstButton during the test
      Object.defineProperty(document, 'activeElement', {
        value: firstButton,
        configurable: true,
        writable: true,
      });

      focusContainer.dispatchEvent(event);

      expect(event.preventDefault).toHaveBeenCalled();
      expect(lastButton.focus).toHaveBeenCalled();

      // Restore original focus
      lastButton.focus = originalFocus;
    });

    test('should allow normal Tab navigation between middle elements', () => {
      cleanup = trapFocus(focusContainer);

      middleButton.focus();
      const event = new KeyboardEvent('keydown', { key: 'Tab' });
      event.preventDefault = jest.fn();
      Object.defineProperty(document, 'activeElement', { value: middleButton, configurable: true });

      focusContainer.dispatchEvent(event);

      expect(event.preventDefault).not.toHaveBeenCalled();
    });

    test('should handle containers with no focusable elements', () => {
      const emptyContainer = document.createElement('div');
      container.appendChild(emptyContainer);

      cleanup = trapFocus(emptyContainer);

      const event = new KeyboardEvent('keydown', { key: 'Tab' });
      event.preventDefault = jest.fn();

      emptyContainer.dispatchEvent(event);

      // Should not throw error
      expect(event.preventDefault).not.toHaveBeenCalled();
    });

    test('should handle containers with single focusable element', () => {
      const singleContainer = document.createElement('div');
      const singleButton = document.createElement('button');
      singleContainer.appendChild(singleButton);
      container.appendChild(singleContainer);

      cleanup = trapFocus(singleContainer);

      singleButton.focus();
      const event = new KeyboardEvent('keydown', { key: 'Tab' });
      event.preventDefault = jest.fn();
      Object.defineProperty(document, 'activeElement', { value: singleButton, configurable: true });

      singleContainer.dispatchEvent(event);

      expect(event.preventDefault).toHaveBeenCalled();
      expect(document.activeElement).toBe(singleButton);
    });

    test('should handle various focusable elements', () => {
      const diverseContainer = document.createElement('div');
      const link = document.createElement('a');
      link.href = '#';
      const input = document.createElement('input');
      const select = document.createElement('select');
      const textarea = document.createElement('textarea');
      const tabindexDiv = document.createElement('div');
      tabindexDiv.tabIndex = 0;

      diverseContainer.appendChild(link);
      diverseContainer.appendChild(input);
      diverseContainer.appendChild(select);
      diverseContainer.appendChild(textarea);
      diverseContainer.appendChild(tabindexDiv);
      container.appendChild(diverseContainer);

      cleanup = trapFocus(diverseContainer);

      // Mock focus method to track calls
      const originalFocus = link.focus;
      link.focus = jest.fn();

      const event = new KeyboardEvent('keydown', { key: 'Tab' });
      event.preventDefault = jest.fn();
      Object.defineProperty(document, 'activeElement', { value: tabindexDiv, configurable: true });

      diverseContainer.dispatchEvent(event);

      expect(event.preventDefault).toHaveBeenCalled();
      expect(link.focus).toHaveBeenCalled();

      // Restore original focus
      link.focus = originalFocus;
    });

    test('should ignore elements with tabindex="-1"', () => {
      const containerWithNegativeTabindex = document.createElement('div');
      const negativeTabindexButton = document.createElement('button');
      negativeTabindexButton.tabIndex = -1;
      const normalButton = document.createElement('button');

      containerWithNegativeTabindex.appendChild(negativeTabindexButton);
      containerWithNegativeTabindex.appendChild(normalButton);
      container.appendChild(containerWithNegativeTabindex);

      cleanup = trapFocus(containerWithNegativeTabindex);

      normalButton.focus();
      const event = new KeyboardEvent('keydown', { key: 'Tab' });
      event.preventDefault = jest.fn();
      Object.defineProperty(document, 'activeElement', { value: normalButton, configurable: true });

      containerWithNegativeTabindex.dispatchEvent(event);

      expect(event.preventDefault).toHaveBeenCalled();
      expect(document.activeElement).toBe(normalButton); // Should wrap to itself
    });

    test('should not trap focus for non-Tab keys', () => {
      cleanup = trapFocus(focusContainer);

      const event = new KeyboardEvent('keydown', { key: 'Enter' });
      event.preventDefault = jest.fn();

      focusContainer.dispatchEvent(event);

      expect(event.preventDefault).not.toHaveBeenCalled();
    });

    test('cleanup function should remove event listeners', () => {
      cleanup = trapFocus(focusContainer);

      // Cleanup
      cleanup();

      lastButton.focus();
      const event = new KeyboardEvent('keydown', { key: 'Tab' });
      event.preventDefault = jest.fn();
      Object.defineProperty(document, 'activeElement', { value: lastButton, configurable: true });

      focusContainer.dispatchEvent(event);

      expect(event.preventDefault).not.toHaveBeenCalled();
    });
  });

  describe('isInputElement helper', () => {
    // Note: isInputElement is not exported, but we can test it indirectly through addModalKeyboardHandlers
    test('should identify input elements correctly through modal handlers', () => {
      const overlay = document.createElement('div');
      const onEscape = jest.fn();
      const onEnter = jest.fn();
      container.appendChild(overlay);

      const cleanup = addModalKeyboardHandlers(overlay, onEscape, onEnter);

      // Test input element
      const input = document.createElement('input');
      overlay.appendChild(input);
      const inputEvent = new KeyboardEvent('keydown', { key: 'Enter' });
      Object.defineProperty(inputEvent, 'target', { value: input, configurable: true });
      overlay.dispatchEvent(inputEvent);
      expect(onEnter).not.toHaveBeenCalled();

      // Test textarea element
      const textarea = document.createElement('textarea');
      overlay.appendChild(textarea);
      const textareaEvent = new KeyboardEvent('keydown', { key: 'Enter' });
      Object.defineProperty(textareaEvent, 'target', { value: textarea, configurable: true });
      overlay.dispatchEvent(textareaEvent);
      expect(onEnter).not.toHaveBeenCalled();

      // Test select element
      const select = document.createElement('select');
      overlay.appendChild(select);
      const selectEvent = new KeyboardEvent('keydown', { key: 'Enter' });
      Object.defineProperty(selectEvent, 'target', { value: select, configurable: true });
      overlay.dispatchEvent(selectEvent);
      expect(onEnter).not.toHaveBeenCalled();

      // Test contentEditable element
      const div = document.createElement('div');
      div.contentEditable = 'true';
      overlay.appendChild(div);
      const divEvent = new KeyboardEvent('keydown', { key: 'Enter' });
      Object.defineProperty(divEvent, 'target', { value: div, configurable: true });
      overlay.dispatchEvent(divEvent);
      expect(onEnter).not.toHaveBeenCalled();

      // Test regular div (should trigger onEnter)
      const regularDiv = document.createElement('div');
      overlay.appendChild(regularDiv);
      const regularEvent = new KeyboardEvent('keydown', { key: 'Enter' });
      Object.defineProperty(regularEvent, 'target', { value: regularDiv, configurable: true });
      overlay.dispatchEvent(regularEvent);
      expect(onEnter).toHaveBeenCalledTimes(1);

      cleanup();
    });

    test('should handle null target element', () => {
      const overlay = document.createElement('div');
      const onEscape = jest.fn();
      const onEnter = jest.fn();
      container.appendChild(overlay);

      const cleanup = addModalKeyboardHandlers(overlay, onEscape, onEnter);

      const event = new KeyboardEvent('keydown', { key: 'Enter' });
      Object.defineProperty(event, 'target', { value: null, configurable: true });
      overlay.dispatchEvent(event);

      // Should still call onEnter for null target (treated as non-input)
      expect(onEnter).toHaveBeenCalledTimes(1);

      cleanup();
    });
  });

  describe('Edge cases and error handling', () => {
    test('should handle null event targets', () => {
      const overlay = document.createElement('div');
      const onEscape = jest.fn();
      const onEnter = jest.fn();
      container.appendChild(overlay);

      const cleanup = addModalKeyboardHandlers(overlay, onEscape, onEnter);

      // Create event with null target
      const event = new KeyboardEvent('keydown', { key: 'Enter' });
      Object.defineProperty(event, 'target', { value: null, configurable: true });
      overlay.dispatchEvent(event);

      expect(onEnter).toHaveBeenCalledTimes(1);
      cleanup();
    });

    test('should handle elements with missing style properties gracefully', () => {
      const items = [];
      for (let i = 0; i < 2; i++) {
        const item = document.createElement('div');
        items.push(item);
        container.appendChild(item);
      }

      // Should not throw when working with real DOM elements
      const cleanup = makeItemsKeyboardNavigable(items, jest.fn());
      expect(typeof cleanup).toBe('function');
      cleanup();
    });

    test('should handle containers with no focusable elements in trapFocus', () => {
      const emptyContainer = document.createElement('div');
      container.appendChild(emptyContainer);

      const cleanup = trapFocus(emptyContainer);

      const event = new KeyboardEvent('keydown', { key: 'Tab' });
      event.preventDefault = jest.fn();
      emptyContainer.dispatchEvent(event);

      // Should work without errors
      expect(typeof cleanup).toBe('function');
      expect(event.preventDefault).not.toHaveBeenCalled();
      cleanup();
    });
  });
});
