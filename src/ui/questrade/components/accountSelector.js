/**
 * Account Selector Component
 * A reusable dropdown for selecting accounts with sophisticated modal UI
 */

import { debugLog, extractDomain, stringSimilarity } from '../../../core/utils';
import stateManager from '../../../core/state';
import monarchApi from '../../../api/monarch';
import toast from '../../toast';
import { addModalKeyboardHandlers, makeItemsKeyboardNavigable } from '../../keyboardNavigation';

/**
 * Creates an account selector dropdown
 *
 * @param {Object} options - Configuration options
 * @param {Array<Object>} options.accounts - List of accounts to select from
 * @param {Function} options.onChange - Callback when selection changes
 * @param {string} options.selectedId - Initially selected account ID
 * @param {string} options.labelText - Text to show as label (default: "Select Account:")
 * @param {string} options.placeholderText - Placeholder text when no selection (default: "Choose an account...")
 * @param {boolean} options.required - Whether selection is required (default: true)
 * @returns {HTMLElement} The created selector element
 */
export function createAccountSelector({
  accounts = [],
  onChange = null,
  selectedId = null,
  labelText = 'Select Account:',
  placeholderText = 'Choose an account...',
  required = true,
}) {
  // Create container
  const container = document.createElement('div');
  container.className = 'account-selector-container';
  container.style.cssText = 'margin: 10px 0; display: flex; flex-direction: column; gap: 5px;';

  // Create label
  const label = document.createElement('label');
  label.textContent = labelText;
  label.style.cssText = 'font-weight: bold; font-size: 14px;';
  container.appendChild(label);

  // Create select element
  const select = document.createElement('select');
  select.className = 'account-selector';
  select.style.cssText = 'padding: 8px; border-radius: 4px; border: 1px solid #ccc; font-size: 14px; width: 100%;';

  if (required) {
    select.setAttribute('required', 'required');
  }

  // Add placeholder option
  const placeholderOption = document.createElement('option');
  placeholderOption.value = '';
  placeholderOption.textContent = placeholderText;
  placeholderOption.disabled = true;
  placeholderOption.selected = !selectedId;
  select.appendChild(placeholderOption);

  // Add account options
  accounts.forEach((account) => {
    const option = document.createElement('option');
    option.value = account.id;
    option.textContent = account.nickname || account.name || account.displayName;
    option.selected = account.id === selectedId;
    select.appendChild(option);
  });

  // Handle empty accounts array
  if (accounts.length === 0) {
    select.disabled = true;
    const emptyOption = document.createElement('option');
    emptyOption.value = '';
    emptyOption.textContent = 'No accounts available';
    select.appendChild(emptyOption);
  }

  // Add event listener
  if (onChange && typeof onChange === 'function') {
    select.addEventListener('change', (event) => {
      const selectedAccount = accounts.find((acc) => acc.id === event.target.value);
      onChange(selectedAccount);
    });
  }

  container.appendChild(select);
  return container;
}

/**
 * Creates a Monarch account mapping selector
 * This specialized selector links Questrade accounts to Monarch accounts
 *
 * @param {string} questradeAccountId - Questrade account ID to map
 * @param {string} questradeAccountName - Questrade account name
 * @param {Array<Object>} monarchAccounts - Available Monarch accounts
 * @param {string} storagePrefix - Storage prefix for saving mapping
 * @returns {HTMLElement} The created selector element
 */
export function createMonarchAccountMappingSelector(
  questradeAccountId,
  questradeAccountName,
  monarchAccounts,
  storagePrefix,
) {
  // Get existing mapping if any
  let existingMapping = null;
  try {
    existingMapping = JSON.parse(GM_getValue(`${storagePrefix}${questradeAccountId}`, null));
  } catch (error) {
    debugLog('Error parsing existing account mapping:', error);
  }

  // Setup callback for selection change
  const handleAccountSelection = (selectedAccount) => {
    if (!selectedAccount) return;

    try {
      // Store mapping
      GM_setValue(`${storagePrefix}${questradeAccountId}`, JSON.stringify(selectedAccount));

      // Update state
      stateManager.setAccount(questradeAccountId, questradeAccountName);

      // Notify user
      toast.show(`Mapped ${questradeAccountName} to ${selectedAccount.displayName} in Monarch`, 'info');

      debugLog(`Account mapping saved: ${questradeAccountName} -> ${selectedAccount.displayName}`, {
        questradeId: questradeAccountId,
        monarchId: selectedAccount.id,
      });
    } catch (error) {
      toast.show('Error saving account mapping', 'error');
      debugLog('Error saving account mapping:', error);
    }
  };

  // Create and return the selector
  return createAccountSelector({
    accounts: monarchAccounts,
    onChange: handleAccountSelection,
    selectedId: existingMapping?.id || null,
    labelText: `Map Questrade "${questradeAccountName}" to Monarch account:`,
    placeholderText: 'Select Monarch account...',
    required: true,
  });
}

/**
 * Show sophisticated Monarch account selector with institution-based selection
 * Based on the original script's showMonarchAccountSelector functionality
 * @param {Array} accounts - List of available accounts
 * @param {Function} callback - Callback function to receive selected account
 * @param {Array} originalAccounts - Original full accounts list for navigation
 * @param {string} accountType - Account type filter ('brokerage', 'credit', etc.)
 * @returns {Promise} Promise that resolves when selection is complete
 */
export async function showMonarchAccountSelector(accounts, callback, originalAccounts = null, accountType = null) {
  debugLog('Starting account selector with', {
    accountsCount: accounts.length,
    hasOriginalAccounts: Boolean(originalAccounts),
    accountType,
  });

  // If originalAccounts is not provided, this is the initial call
  const allAccounts = originalAccounts || accounts;

  // Determine account type from the accounts if not provided
  const effectiveAccountType = accountType || (accounts.length > 0 && accounts[0].type?.name) || 'brokerage';

  try {
    // First, fetch institution data
    debugLog('Fetching institution data for account selector');
    const institutionData = await monarchApi.getInstitutionSettings();

    // Get current domain for matching
    const currentDomain = extractDomain(window.location.href);

    // Create a map of credentials and accounts
    const credentials = institutionData.credentials || [];
    const monarchAccounts = institutionData.accounts || [];

    // Create a map of credential ID to accounts
    const credentialAccounts = {};
    monarchAccounts.forEach((account) => {
      if (account.credential && account.credential.id) {
        if (!credentialAccounts[account.credential.id]) {
          credentialAccounts[account.credential.id] = [];
        }

        // Add relevant account details
        credentialAccounts[account.credential.id].push({
          ...account,
          // Add detailed account info from our filtered account list
          details: allAccounts.find((acc) => acc.id === account.id),
        });
      }
    });

    // Create credential list with account info
    const institutionList = credentials.map((cred) => {
      const credAccounts = credentialAccounts[cred.id] || [];

      // Check if any accounts in this institution match our account type filter
      const hasMatchingAccounts = credAccounts.some((acc) => acc.details && !acc.deletedAt);

      // Extract domain from institution URL
      const institutionDomain = extractDomain(cred.institution?.url);

      // Calculate domain match score
      let domainMatchScore;
      if (institutionDomain && currentDomain) {
        domainMatchScore = institutionDomain === currentDomain ? 1 : 0;
      } else {
        domainMatchScore = 0;
      }

      return {
        credential: cred,
        accounts: credAccounts.filter((acc) => acc.details && !acc.deletedAt),
        hasMatchingAccounts,
        domainMatchScore,
      };
    });

    // Filter to only show institutions with valid accounts of the right type
    const validInstitutions = institutionList.filter((inst) => inst.hasMatchingAccounts);

    // Sort by domain match score (descending) then by name
    validInstitutions.sort((a, b) => {
      if (b.domainMatchScore !== a.domainMatchScore) {
        return b.domainMatchScore - a.domainMatchScore;
      }
      return a.credential.institution?.name?.localeCompare(b.credential.institution?.name || '');
    });

    // Display the institutions
    debugLog('Showing institution selector with', {
      institutionCount: validInstitutions.length,
      allAccountsCount: allAccounts.length,
      accountType: effectiveAccountType,
    });

    showInstitutionSelector(validInstitutions, callback, effectiveAccountType);
  } catch (error) {
    debugLog('Failed to get institution data:', error);
    // Fall back to original account selector if we can't get institution data
    showFlatAccountSelector(accounts, callback);
  }
}

/**
 * Show the institution selection screen
 * @param {Array} institutions - List of institutions with account info
 * @param {Function} callback - Callback for final account selection
 * @param {string} accountType - Account type being selected
 */
function showInstitutionSelector(institutions, callback, accountType = 'brokerage') {
  debugLog('Showing institution selector with', {
    institutionsCount: institutions ? institutions.length : 0,
    accountType,
  });

  // Set up keyboard navigation cleanup function
  let cleanupKeyboard = () => {};

  // Create overlay
  const overlay = createModalOverlay(() => {
    cleanupKeyboard();
    overlay.remove();
    callback(null);
  });

  // Create modal content
  const modal = document.createElement('div');
  modal.style.cssText = `
    background: white;
    padding: 25px;
    border-radius: 8px;
    width: 90%;
    max-width: 500px;
    max-height: 80vh;
    overflow-y: auto;
  `;

  // Add header
  const header = document.createElement('h2');
  header.style.cssText = 'margin-top:0; margin-bottom: 20px; font-size: 1.2em;';
  header.textContent = 'Select Institution';
  modal.appendChild(header);

  // No institutions message
  if (!institutions.length) {
    const noInst = document.createElement('div');
    let accountTypeDisplay;
    if (accountType === 'credit') {
      accountTypeDisplay = 'credit card';
    } else if (accountType === 'brokerage') {
      accountTypeDisplay = 'investment';
    } else {
      accountTypeDisplay = accountType;
    }
    noInst.textContent = `No institutions found with ${accountTypeDisplay} accounts.`;
    noInst.style.cssText = 'color: #666; padding: 20px 0;';
    modal.appendChild(noInst);
  }

  const institutionItems = [];

  // Add each institution
  institutions.forEach((inst) => {
    const cred = inst.credential;

    // Create the main container
    const item = document.createElement('div');
    item.style.cssText = `
      display: flex;
      align-items: center;
      padding: 15px;
      border-radius: 8px;
      cursor: pointer;
      margin-bottom: 15px;
      border: 1px solid #eee;
      transition: all 0.2s;
      position: relative;
    `;

    // Create left section with logo
    const logoContainer = document.createElement('div');
    logoContainer.style.cssText = 'margin-right: 15px; flex-shrink: 0;';

    // Logo priority: 1) Institution base64, 2) Account logoUrl, 3) Institution external URL, 4) Letter fallback
    let logoHandled = false;

    // First priority: Institution base64 logo
    if (cred.institution?.logo && !logoHandled) {
      try {
        const isUrl = typeof cred.institution.logo === 'string'
                     && (cred.institution.logo.trim().toLowerCase().startsWith('http')
                      || cred.institution.logo.trim().toLowerCase().startsWith('//'));

        if (!isUrl) {
          // Base64 data - highest priority
          const logoImg = document.createElement('img');
          logoImg.src = `data:image/png;base64,${cred.institution.logo}`;
          logoImg.style.cssText = 'width: 40px; height: 40px; border-radius: 5px; object-fit: contain;';
          logoContainer.appendChild(logoImg);
          logoHandled = true;
        }
      } catch (e) {
        // Continue to next priority if base64 fails
      }
    }

    // Second priority: Account logoUrl
    if (!logoHandled) {
      const accountWithLogo = inst.accounts?.find((acc) => acc.details?.logoUrl);
      if (accountWithLogo && accountWithLogo.details.logoUrl) {
        try {
          GM_addElement(logoContainer, 'img', {
            src: accountWithLogo.details.logoUrl,
            style: 'width: 40px; height: 40px; border-radius: 5px; object-fit: contain;',
          });
          logoHandled = true;
        } catch (e) {
          // Continue to next priority if account logo fails
        }
      }
    }

    // Third priority: Institution external URL logo
    if (!logoHandled && cred.institution?.logo) {
      try {
        const isUrl = typeof cred.institution.logo === 'string'
                     && (cred.institution.logo.trim().toLowerCase().startsWith('http')
                      || cred.institution.logo.trim().toLowerCase().startsWith('//'));

        if (isUrl) {
          GM_addElement(logoContainer, 'img', {
            src: cred.institution.logo,
            style: 'width: 40px; height: 40px; border-radius: 5px; object-fit: contain;',
          });
          logoHandled = true;
        }
      } catch (e) {
        // Continue to final fallback
      }
    }

    // Final fallback: Letter-based logo
    if (!logoHandled) {
      addLogoFallback(logoContainer, cred.institution?.name);
    }
    item.appendChild(logoContainer);

    // Create center section with text details
    const infoDiv = document.createElement('div');
    infoDiv.style.cssText = 'flex-grow: 1;';

    // Institution name
    const nameDiv = document.createElement('div');
    nameDiv.style.cssText = 'font-weight: bold; font-size: 1.1em;';
    nameDiv.textContent = cred.institution?.name || 'Unknown Institution';
    infoDiv.appendChild(nameDiv);

    // Data provider name
    const providerDiv = document.createElement('div');
    providerDiv.style.cssText = 'font-size: 0.9em; color: #666;';
    providerDiv.textContent = cred.dataProvider || '';
    infoDiv.appendChild(providerDiv);

    item.appendChild(infoDiv);

    // Add recommended badge if matching domain
    if (inst.domainMatchScore > 0) {
      const badge = document.createElement('div');
      badge.style.cssText = `
        position: absolute;
        top: 8px;
        right: 8px;
        background-color: #e3f2fd;
        color: #1565c0;
        font-size: 0.75em;
        padding: 2px 6px;
        border-radius: 4px;
      `;
      badge.textContent = 'Recommended';
      item.appendChild(badge);

      // Add extra margin below for spacing if recommended
      item.style.marginBottom = '20px';
    }

    // Add right arrow icon
    const arrowContainer = document.createElement('div');
    arrowContainer.style.cssText = `
      margin-left: 15px;
      font-size: 1.5em;
      color: #aaa;
      position: relative;
      z-index: 1;
    `;
    arrowContainer.innerHTML = '&rsaquo;';
    item.appendChild(arrowContainer);

    // Add hover effect
    item.onmouseover = () => {
      item.style.backgroundColor = '#f5f5f5';
      item.style.borderColor = '#ddd';
    };
    item.onmouseout = () => {
      item.style.backgroundColor = '';
      item.style.borderColor = '#eee';
    };

    // Add click handler to show accounts for this institution
    item.onclick = () => {
      debugLog('Navigating to account selector with all institutions data:', {
        selectedInstitution: cred.institution?.name || 'Unknown',
        totalInstitutions: institutions.length,
      });
      cleanupKeyboard();
      overlay.remove();
      showAccountSelector(inst, callback, institutions, accountType);
    };

    modal.appendChild(item);
    institutionItems.push(item);
  });

  // Add a cancel button
  const cancelBtn = document.createElement('button');
  cancelBtn.textContent = 'Cancel';
  cancelBtn.style.cssText = `
    padding: 8px 16px;
    background-color: #f5f5f5;
    color: #333;
    border: none;
    border-radius: 4px;
    cursor: pointer;
    margin-top: 10px;
  `;
  cancelBtn.onclick = () => {
    cleanupKeyboard();
    overlay.remove();
    callback(null);
  };
  modal.appendChild(cancelBtn);

  // Add keyboard handlers for the modal (Escape to close)
  const cleanupModalHandlers = addModalKeyboardHandlers(overlay, () => {
    cleanupKeyboard();
    overlay.remove();
    callback(null);
  });

  // Make institution items keyboard navigable if there are any
  let cleanupItemNavigation = () => {};
  if (institutionItems.length > 0) {
    cleanupItemNavigation = makeItemsKeyboardNavigable(
      institutionItems,
      (item, index) => {
        // Same logic as click handler
        const inst = institutions[index];
        const cred = inst.credential;
        debugLog('Keyboard selecting institution:', {
          selectedInstitution: cred.institution?.name || 'Unknown',
          totalInstitutions: institutions.length,
        });
        cleanupKeyboard();
        overlay.remove();
        showAccountSelector(inst, callback, institutions, accountType);
      },
      0, // Focus first item initially
    );
  }

  // Combine cleanup functions
  cleanupKeyboard = () => {
    cleanupModalHandlers();
    cleanupItemNavigation();
  };

  // Show the modal
  overlay.appendChild(modal);
  document.body.appendChild(overlay);
}

/**
 * Show the account selection screen for a specific institution
 * @param {Object} institution - Institution object with accounts
 * @param {Function} callback - Callback for account selection
 * @param {Array} allInstitutions - All institutions for navigation
 * @param {string} accountType - Account type being selected
 */
function showAccountSelector(institution, callback, allInstitutions, accountType = 'brokerage') {
  // Store all institutions for navigation
  const allInsts = allInstitutions || [institution];

  // Get institution details
  const cred = institution.credential;
  const accounts = institution.accounts || [];

  // Get current account context for name matching
  const currentState = stateManager.getState();
  const currentAccountName = currentState.currentAccount.nickname || '';

  debugLog('Showing account selector for institution:', {
    institutionName: cred.institution?.name || 'Unknown',
    accountsCount: accounts.length,
    allInstitutionsAvailable: Boolean(allInstitutions),
  });

  if (!accounts.length) {
    toast.show(`No valid accounts found for ${cred.institution?.name || 'this institution'}`, 'error');
    callback(null);
    return;
  }

  // Calculate similarity scores for account names
  const accountsWithScores = accounts.map((account) => {
    // Calculate similarity score to the current account name
    const similarityScore = stringSimilarity(
      account.details?.displayName || '',
      currentAccountName || '',
    );

    return {
      ...account,
      similarityScore,
    };
  });

  // Sort by similarity score (highest first)
  accountsWithScores.sort((a, b) => b.similarityScore - a.similarityScore);

  // Set up keyboard navigation cleanup function
  let cleanupKeyboard = () => {};

  // Create the overlay first (declared early to avoid use-before-define)
  let overlay;

  // Helper to close modal with cleanup
  const closeModal = () => {
    cleanupKeyboard();
    overlay.remove();
    callback(null);
  };

  const backAction = () => {
    debugLog('Navigating back to institution list', {
      allInstsLength: allInsts?.length || 0,
      firstInstitutionName: allInsts && allInsts.length > 0
        ? (allInsts[0].credential?.institution?.name || 'Unknown') : 'None',
    });

    cleanupKeyboard();
    overlay.remove();
    // Re-show the institution selector with the full original institutions list
    showInstitutionSelector(allInsts, callback, accountType);
  };

  // Now initialize the overlay with the closeModal function
  overlay = createModalOverlay(closeModal);

  // Create the modal
  const modal = document.createElement('div');
  modal.style.cssText = `
    background: white;
    padding: 25px;
    border-radius: 8px;
    width: 90%;
    max-width: 500px;
    max-height: 80vh;
    overflow-y: auto;
  `;

  // Create back button
  const backButton = document.createElement('div');
  backButton.style.cssText = `
    display: flex;
    align-items: center;
    font-size: 0.9em;
    color: #0066cc;
    cursor: pointer;
    margin-bottom: 20px;
  `;
  backButton.innerHTML = '&lsaquo; Back to institutions';
  backButton.onclick = backAction;
  modal.appendChild(backButton);

  // Add header with institution name
  const header = document.createElement('h2');
  header.style.cssText = 'margin-top:0; margin-bottom: 20px; font-size: 1.2em;';
  header.textContent = cred.institution?.name || 'Select Account';
  modal.appendChild(header);

  // Add Questrade account reference header
  const accountRef = document.createElement('div');
  accountRef.style.cssText = 'margin-bottom: 15px; font-size: 0.95em;';
  accountRef.innerHTML = `Selecting Monarch account for <b>${currentAccountName}</b>`;
  modal.appendChild(accountRef);

  // Get institution logo once to reuse
  let institutionLogoImg = null;
  if (cred.institution?.logo) {
    try {
      const isUrl = typeof cred.institution.logo === 'string'
                    && (cred.institution.logo.trim().toLowerCase().startsWith('http')
                     || cred.institution.logo.trim().toLowerCase().startsWith('//'));

      if (isUrl) {
        institutionLogoImg = cred.institution.logo;
      } else {
        institutionLogoImg = `data:image/png;base64,${cred.institution.logo}`;
      }
    } catch (e) {
      debugLog('Error processing institution logo:', e);
    }
  }

  const accountItems = [];

  // Add accounts
  accountsWithScores.forEach((account, index) => {
    // Create list item container
    const item = document.createElement('div');
    item.style.cssText = `
      display: flex;
      align-items: center;
      padding: 15px;
      border-radius: 8px;
      cursor: pointer;
      margin-bottom: 15px;
      border: 1px solid #eee;
      transition: all 0.2s;
      position: relative;
    `;

    // Add highlight for first/recommended item
    if (index === 0) {
      item.style.backgroundColor = '#f5f8ff';
      item.style.borderColor = '#d0d9e6';
    }

    // Create logo container
    const logoContainer = document.createElement('div');
    logoContainer.style.cssText = 'margin-right: 15px; flex-shrink: 0;';

    // Logo priority: 1) Institution base64, 2) Account logoUrl, 3) Institution external URL, 4) Letter fallback
    let logoHandled = false;

    // First priority: Institution base64 logo (already processed above if available)
    if (institutionLogoImg && !logoHandled) {
      const isUrl = institutionLogoImg.startsWith('http') || institutionLogoImg.startsWith('//');

      if (!isUrl) {
        // Base64 data - highest priority
        const logoImg = document.createElement('img');
        logoImg.src = institutionLogoImg;
        logoImg.style.cssText = 'width: 40px; height: 40px; border-radius: 5px; object-fit: contain;';
        logoContainer.appendChild(logoImg);
        logoHandled = true;
      }
    }

    // Second priority: Account logoUrl
    if (!logoHandled) {
      const accountWithLogo = accounts?.find((acc) => acc.details?.logoUrl);
      if (accountWithLogo && accountWithLogo.details.logoUrl) {
        try {
          GM_addElement(logoContainer, 'img', {
            src: accountWithLogo.details.logoUrl,
            style: 'width: 40px; height: 40px; border-radius: 5px; object-fit: contain;',
          });
          logoHandled = true;
        } catch (e) {
          // Continue to next priority if account logo fails
        }
      }
    }

    // Third priority: Institution external URL logo
    if (!logoHandled && institutionLogoImg) {
      const isUrl = institutionLogoImg.startsWith('http') || institutionLogoImg.startsWith('//');

      if (isUrl) {
        try {
          GM_addElement(logoContainer, 'img', {
            src: institutionLogoImg,
            style: 'width: 40px; height: 40px; border-radius: 5px; object-fit: contain;',
          });
          logoHandled = true;
        } catch (e) {
          // Continue to final fallback
        }
      }
    }

    // Final fallback: Letter-based logo
    if (!logoHandled) {
      addLogoFallback(logoContainer, cred.institution?.name);
    }
    item.appendChild(logoContainer);

    // Create text container
    const textContainer = document.createElement('div');
    textContainer.style.flexGrow = '1';

    // Account name
    const nameDiv = document.createElement('div');
    nameDiv.style.cssText = 'font-weight: bold;';
    nameDiv.textContent = account.details?.displayName || account.displayName || 'Unknown Account';
    textContainer.appendChild(nameDiv);

    // Account balance
    if (account.details?.currentBalance !== undefined) {
      const balanceDiv = document.createElement('div');
      balanceDiv.style.cssText = 'font-size: 0.9em; color: #555;';
      balanceDiv.textContent = `Balance: ${new Intl.NumberFormat().format(account.details.currentBalance)}`;
      textContainer.appendChild(balanceDiv);
    }

    // Account subtype if available
    if (account.subtype?.display) {
      const subtypeDiv = document.createElement('div');
      subtypeDiv.style.cssText = 'font-size: 0.85em; color: #666;';
      subtypeDiv.textContent = account.subtype.display;
      textContainer.appendChild(subtypeDiv);
    }

    // Add recommended badge for first item
    if (index === 0) {
      const badge = document.createElement('div');
      badge.style.cssText = `
        position: absolute;
        top: 8px;
        right: 8px;
        background-color: #e8f5e9;
        color: #2e7d32;
        font-size: 0.75em;
        padding: 2px 6px;
        border-radius: 4px;
      `;
      badge.textContent = 'Recommended';
      item.appendChild(badge);

      // Add extra margin below for spacing if recommended
      item.style.marginBottom = '20px';
    }

    item.appendChild(textContainer);

    // Hover effects
    item.onmouseover = () => {
      if (index !== 0) {
        item.style.backgroundColor = '#f5f5f5';
      } else {
        item.style.backgroundColor = '#eef2fd';
      }
      item.style.borderColor = '#ddd';
    };
    item.onmouseout = () => {
      if (index !== 0) {
        item.style.backgroundColor = '';
      } else {
        item.style.backgroundColor = '#f5f8ff';
        item.style.borderColor = '#d0d9e6';
      }
      item.style.borderColor = index === 0 ? '#d0d9e6' : '#eee';
    };

    // Click handler
    item.onclick = () => {
      cleanupKeyboard();
      overlay.remove();
      callback(account.details);
    };

    modal.appendChild(item);
    accountItems.push(item);
  });

  // Add a cancel button
  const cancelBtn = document.createElement('button');
  cancelBtn.textContent = 'Cancel';
  cancelBtn.style.cssText = `
    padding: 8px 16px;
    background-color: #f5f5f5;
    color: #333;
    border: none;
    border-radius: 4px;
    cursor: pointer;
    margin-top: 10px;
  `;
  cancelBtn.onclick = closeModal;
  modal.appendChild(cancelBtn);

  // Add keyboard handlers for the modal (Escape to close)
  const cleanupModalHandlers = addModalKeyboardHandlers(overlay, closeModal);

  // Make account items keyboard navigable if there are any
  let cleanupItemNavigation = () => {};
  if (accountItems.length > 0) {
    cleanupItemNavigation = makeItemsKeyboardNavigable(
      accountItems,
      (item, index) => {
        // Same logic as click handler
        const account = accountsWithScores[index];
        debugLog('Keyboard selecting account:', {
          selectedAccount: account.details?.displayName || account.displayName || 'Unknown Account',
          totalAccounts: accountsWithScores.length,
        });
        cleanupKeyboard();
        overlay.remove();
        callback(account.details);
      },
      0, // Focus first item initially
    );
  }

  // Make back button keyboard navigable
  backButton.setAttribute('tabindex', '0');
  backButton.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      backAction();
    }
  });

  // Combine cleanup functions
  cleanupKeyboard = () => {
    cleanupModalHandlers();
    cleanupItemNavigation();
  };

  // Show the modal
  overlay.appendChild(modal);
  document.body.appendChild(overlay);
}

/**
 * Fallback to the original flat account selector if needed
 * @param {Array} accounts - List of accounts
 * @param {Function} callback - Callback for account selection
 */
function showFlatAccountSelector(accounts, callback) {
  // Create the overlay and modal elements
  const overlay = createModalOverlay(() => {
    overlay.remove();
    callback(null);
  });

  const modal = document.createElement('div');
  modal.style.cssText = `
    background: white;
    padding: 25px;
    border-radius: 8px;
    width: 90%;
    max-width: 500px;
    max-height: 80vh;
    overflow-y: auto;
  `;

  // Get current account name for display
  const currentState = stateManager.getState();
  const currentAccountName = currentState.currentAccount.nickname || 'Unknown Account';

  const title = document.createElement('h2');
  title.style.cssText = 'margin-top:0; margin-bottom: 20px; font-size: 1em;';
  title.innerHTML = `Select Monarch Account for <b>${currentAccountName}</b>`;
  modal.appendChild(title);

  accounts.forEach((acc) => {
    // Create the main container for the list item
    const item = document.createElement('div');
    item.style.cssText = `
      display: flex;
      align-items: center;
      padding: 10px;
      border-radius: 5px;
      cursor: pointer;
      margin-bottom: 10px;
      border: 1px solid #eee;
    `;

    // Add logo image using GM_addElement for external URLs to avoid CSP issues
    if (acc.logoUrl) {
      GM_addElement(item, 'img', {
        src: acc.logoUrl,
        style: 'width: 40px; height: 40px; margin-right: 15px; border-radius: 5px;',
      });
    }

    // Create the container for the account text details
    const infoDiv = document.createElement('div');
    infoDiv.style.flexGrow = '1';

    // Create and append the account name
    const nameDiv = document.createElement('div');
    nameDiv.style.fontWeight = 'bold';
    nameDiv.textContent = acc.displayName;
    infoDiv.appendChild(nameDiv);

    // Create and append the account balance
    const balanceDiv = document.createElement('div');
    balanceDiv.style.cssText = 'font-size: 0.9em; color: #555;';
    balanceDiv.textContent = `Balance: ${new Intl.NumberFormat().format(acc.currentBalance)}`;
    infoDiv.appendChild(balanceDiv);

    // Append the text info container to the main item
    item.appendChild(infoDiv);

    // Add event listeners
    item.onmouseover = () => {
      item.style.backgroundColor = '#f0f0f0';
    };
    item.onmouseout = () => {
      item.style.backgroundColor = 'transparent';
    };
    item.onclick = () => { overlay.remove(); callback(acc); };

    modal.appendChild(item);
  });

  overlay.appendChild(modal);
  document.body.appendChild(overlay);
}

/**
 * Create a modal overlay with standard styling
 * @param {Function} onClickOutside - Handler for clicking outside modal
 * @returns {HTMLElement} Overlay element
 */
function createModalOverlay(onClickOutside) {
  const overlay = document.createElement('div');
  overlay.style.cssText = `
    position: fixed;
    top: 0;
    left: 0;
    width: 100%;
    height: 100%;
    background: rgba(0,0,0,0.7);
    display: flex;
    align-items: center;
    justify-content: center;
    z-index: 10000;
  `;

  // Add click outside handler if provided
  if (onClickOutside) {
    overlay.onclick = (e) => {
      if (e.target === overlay) {
        onClickOutside();
      }
    };
  }

  return overlay;
}

/**
 * Add a logo fallback (first letter) to a container
 * @param {HTMLElement} container - Container to add logo to
 * @param {string} institutionName - Institution name for fallback
 */
function addLogoFallback(container, institutionName) {
  const logoFallback = document.createElement('div');
  logoFallback.style.cssText = `
    width: 40px;
    height: 40px;
    border-radius: 5px;
    background-color: #e0e0e0;
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 20px;
    color: #666;
    font-weight: bold;
  `;
  const [firstChar] = institutionName || '?';
  logoFallback.textContent = firstChar;
  container.appendChild(logoFallback);
}

export default {
  create: createAccountSelector,
  createMonarchMapping: createMonarchAccountMappingSelector,
  showMonarchAccountSelector,
  showInstitutionSelector,
  showAccountSelector,
  showFlatAccountSelector,
};
