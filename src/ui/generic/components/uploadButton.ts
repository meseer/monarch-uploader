/**
 * Generic Upload Button Component
 *
 * Creates a styled upload button parameterized by brand color.
 * No institution-specific logic — works for any modular integration.
 *
 * @module ui/generic/components/uploadButton
 */

interface StyledButtonOptions {
  color?: string;
  hoverColor?: string;
  id?: string;
  className?: string;
  disabled?: boolean;
}

interface UploadButtonParams {
  isAuthenticated: boolean;
  institutionName: string;
  onUploadClick?: (button: HTMLButtonElement) => void;
}

/**
 * Darken a hex color by a percentage for hover effects
 */
export function darkenColor(hex: string, percent = 20): string {
  const num = parseInt(hex.replace('#', ''), 16);
  const r = Math.max(0, (num >> 16) - Math.round(2.55 * percent));
  const g = Math.max(0, ((num >> 8) & 0x00FF) - Math.round(2.55 * percent));
  const b = Math.max(0, (num & 0x0000FF) - Math.round(2.55 * percent));
  return `#${(1 << 24 | r << 16 | g << 8 | b).toString(16).slice(1)}`;
}

/**
 * Creates a styled button with the given brand color
 */
function createStyledButton(text: string, onClick: ((e: Event) => void) | null, options: StyledButtonOptions = {}): HTMLButtonElement {
  const button = document.createElement('button');
  button.textContent = text;
  const color = options.color || '#28a745';
  const hoverColor = options.hoverColor || darkenColor(color);

  button.style.cssText = `
    background-color: ${color};
    color: white;
    border: none;
    border-radius: 4px;
    padding: 10px 16px;
    margin: 5px 0;
    font-size: 14px;
    font-weight: 500;
    cursor: pointer;
    transition: all 0.2s ease;
    box-shadow: 0 2px 4px rgba(0, 0, 0, 0.15);
    ${options.disabled ? 'opacity: 0.6; cursor: not-allowed;' : ''}
  `;

  if (options.id) {
    button.id = options.id;
  }

  if (options.className) {
    button.className = options.className;
  }

  button.disabled = Boolean(options.disabled);

  button.addEventListener('mouseover', () => {
    if (!button.disabled) {
      button.style.backgroundColor = hoverColor;
      button.style.transform = 'translateY(-1px)';
      button.style.boxShadow = '0 4px 8px rgba(0, 0, 0, 0.2)';
    }
  });

  button.addEventListener('mouseout', () => {
    if (!button.disabled) {
      button.style.backgroundColor = color;
      button.style.transform = 'translateY(0)';
      button.style.boxShadow = '0 2px 4px rgba(0, 0, 0, 0.15)';
    }
  });

  if (onClick && !options.disabled) {
    button.addEventListener('click', onClick);
  }

  return button;
}

/**
 * Creates the main upload button for a modular integration
 */
export function createUploadButton({ isAuthenticated, institutionName, onUploadClick }: UploadButtonParams): HTMLElement {
  const container = document.createElement('div');
  container.className = 'generic-upload-button-container';
  container.id = 'generic-upload-button-container';
  container.style.cssText = 'margin: 8px 0;';

  if (!isAuthenticated) {
    const message = document.createElement('div');
    message.id = 'generic-auth-waiting-message';
    message.textContent = `Waiting for ${institutionName} session to be detected...`;
    message.style.cssText = `
      padding: 8px 12px;
      background-color: #fff3cd;
      color: #856404;
      border: 1px solid #ffeaa7;
      border-radius: 4px;
      font-size: 13px;
      margin: 5px 0;
    `;

    const helpText = document.createElement('div');
    helpText.id = 'generic-auth-help-text';
    helpText.textContent = `Log in to your ${institutionName} account to enable uploading.`;
    helpText.style.cssText = `
      padding: 4px 12px;
      font-size: 12px;
      color: #666;
      font-style: italic;
    `;

    container.appendChild(message);
    container.appendChild(helpText);
    return container;
  }

  const uploadButton = createStyledButton('Upload to Monarch', () => {
    if (onUploadClick) {
      onUploadClick(uploadButton);
    }
  }, { color: '#28a745', id: 'generic-upload-button' });

  container.appendChild(uploadButton);

  const infoText = document.createElement('div');
  infoText.id = 'generic-upload-info';
  infoText.textContent = 'Click to upload balance and transactions to Monarch Money.';
  infoText.style.cssText = `
    padding: 4px 0;
    font-size: 12px;
    color: #666;
    font-style: italic;
  `;
  container.appendChild(infoText);

  return container;
}

export default {
  createUploadButton,
  createStyledButton,
  darkenColor,
};