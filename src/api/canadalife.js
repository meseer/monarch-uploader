/**
 * CanadaLife API client
 * Handles authentication and token management for CanadaLife website
 */

import { STORAGE } from '../core/config';
import { debugLog } from '../core/utils';
import stateManager from '../core/state';
import toast from '../ui/toast';

/**
 * Custom error class for Canada Life token expiry
 */
export class CanadaLifeTokenExpiredError extends Error {
  constructor(message, errorDetails = null) {
    super(message);
    this.name = 'CanadaLifeTokenExpiredError';
    this.errorDetails = errorDetails;
    this.recoverable = true;
  }
}

/**
 * Custom error class for Canada Life API errors
 */
export class CanadaLifeApiError extends Error {
  constructor(message, errorDetails = null) {
    super(message);
    this.name = 'CanadaLifeApiError';
    this.errorDetails = errorDetails;
    this.recoverable = false;
  }
}

/**
 * Get CanadaLife token from localStorage
 * @returns {string|null} Token string or null if not found
 */
export function getCanadaLifeToken() {
  try {
    const token = localStorage.getItem(STORAGE.CANADALIFE_TOKEN_KEY);
    if (token && token.trim() !== '') {
      debugLog('CanadaLife token found in localStorage');
      return token;
    }
    debugLog('No CanadaLife token found in localStorage');
    return null;
  } catch (error) {
    debugLog('Error reading CanadaLife token from localStorage:', error);
    return null;
  }
}

/**
 * Check CanadaLife authentication status
 * @returns {Object} Authentication status object
 */
export function checkCanadaLifeAuth() {
  const token = getCanadaLifeToken();
  
  if (token) {
    debugLog('CanadaLife authentication: Connected');
    return {
      authenticated: true,
      token: token,
      source: 'localStorage'
    };
  }
  
  debugLog('CanadaLife authentication: Not connected');
  return {
    authenticated: false,
    token: null,
    source: null
  };
}

/**
 * Check token status and update state
 * @returns {Object|null} Token info if valid
 */
export function checkTokenStatus() {
  const authStatus = checkCanadaLifeAuth();
  
  // Update state manager
  stateManager.setCanadaLifeAuth(authStatus.authenticated ? authStatus.token : null);
  
  return authStatus.authenticated ? authStatus : null;
}

/**
 * Monitor localStorage changes for CanadaLife token
 * This sets up a listener to detect when the user logs in/out
 */
export function setupTokenMonitoring() {
  // Check token status immediately
  checkTokenStatus();
  
  // Set up periodic checking since localStorage events don't always fire reliably
  setInterval(() => {
    checkTokenStatus();
  }, 5000); // Check every 5 seconds
  
  // Also listen for storage events (though may not always work for same-origin changes)
  window.addEventListener('storage', (event) => {
    if (event.key === STORAGE.CANADALIFE_TOKEN_KEY) {
      debugLog('CanadaLife token changed via storage event');
      checkTokenStatus();
    }
  });
  
  debugLog('CanadaLife token monitoring setup complete');
}

/**
 * Extract all cookies from document.cookie and format them for API requests
 * @returns {string} Formatted cookie string
 */
export function extractCookies() {
  try {
    return document.cookie;
  } catch (error) {
    debugLog('Error extracting cookies:', error);
    return '';
  }
}

/**
 * Attempt to refresh the token from localStorage and update state
 * @param {string} currentToken - Current token to compare against
 * @returns {string|null} New token if different from current, null otherwise
 */
function attemptTokenRefresh(currentToken) {
  try {
    const freshToken = getCanadaLifeToken();
    
    if (!freshToken || freshToken === currentToken) {
      debugLog('Token refresh: No new token available or same as current');
      return null;
    }
    
    debugLog('Token refresh: Found updated token, updating state');
    
    // Update state manager with fresh token
    stateManager.setCanadaLifeAuth(freshToken);
    
    return freshToken;
  } catch (error) {
    debugLog('Error during token refresh attempt:', error);
    return null;
  }
}

/**
 * Check API response for errors and handle them appropriately
 * @param {Object} responseData - Parsed API response
 * @param {string} currentToken - Current token used for the request
 * @returns {Object} Response data if no errors
 * @throws {CanadaLifeTokenExpiredError|CanadaLifeApiError} If API errors detected
 */
function checkApiResponseForErrors(responseData, currentToken) {
  // Check if this is a nested response with IPResult
  let ipResult = null;
  
  if (responseData.IPResult) {
    ipResult = responseData.IPResult;
  } else if (responseData.actions && responseData.actions[0] && responseData.actions[0].returnValue) {
    try {
      const nestedData = JSON.parse(responseData.actions[0].returnValue.returnValue || '{}');
      if (nestedData.IPResult) {
        ipResult = nestedData.IPResult;
      }
    } catch (parseError) {
      // Ignore parse errors here, will be handled later if needed
      debugLog('Could not parse nested response for error checking:', parseError.message);
    }
  }
  
  // If no IPResult found, return as-is (might be a different type of response)
  if (!ipResult) {
    return responseData;
  }
  
  // Check for API failure flag
  if (ipResult.activityReportsHasApiFailure === true) {
    debugLog('API failure detected in response:', ipResult);
    
    // Check for errors array
    if (ipResult.result && Array.isArray(ipResult.result.errors) && ipResult.result.errors.length > 0) {
      const errors = ipResult.result.errors;
      debugLog('API errors found:', errors);
      
      // Check for token expiry error (errorId: "004", httpCode: "401")
      const tokenError = errors.find(error => 
        error.errorId === "004" && error.httpCode === "401"
      );
      
      if (tokenError) {
        debugLog('Token expired error detected:', tokenError);
        
        // Try to refresh token
        const freshToken = attemptTokenRefresh(currentToken);
        
        const errorMessage = tokenError.detail || tokenError.summary || 'Access token is invalid';
        
        if (freshToken) {
          // New token available, this error is recoverable
          throw new CanadaLifeTokenExpiredError(
            `Token expired: ${errorMessage}. Retrying with fresh token.`,
            tokenError
          );
        } else {
          // No new token available, unrecoverable
          const unrecoverableError = new CanadaLifeTokenExpiredError(
            `Token expired: ${errorMessage}. Please refresh the page or log back into Canada Life.`,
            tokenError
          );
          unrecoverableError.recoverable = false;
          throw unrecoverableError;
        }
      }
      
      // Handle other API errors
      const firstError = errors[0];
      const errorMessage = firstError.detail || firstError.summary || 'Unknown API error occurred';
      
      debugLog('Non-token API error detected:', firstError);
      throw new CanadaLifeApiError(
        `Canada Life API error: ${errorMessage}`,
        firstError
      );
    }
    
    // API failure flag set but no specific errors found
    throw new CanadaLifeApiError(
      'Canada Life API reported a failure but no specific error details were provided',
      { activityReportsHasApiFailure: true }
    );
  }
  
  return responseData;
}

/**
 * Make a generic Aura API call to Canada Life with error handling and retry logic
 * @param {Object} payload - The payload object to send
 * @param {Object} options - Additional options
 * @param {boolean} options.extractNestedResponse - Whether to automatically extract nested JSON from returnValue
 * @param {boolean} options.isRetry - Internal flag to indicate this is a retry attempt
 * @param {AbortSignal} options.signal - Abort signal for cancellation support
 * @returns {Promise<Object>} API response
 */
export async function makeAuraApiCall(payload, options = {}) {
  const isRetry = options.isRetry || false;
  const maxRetries = 1; // Only allow one retry for token expiry
  
  try {
    const state = stateManager.getState();
    let auraToken = state.auth.canadalife.token;
    
    if (!auraToken) {
      throw new Error('No Aura token found. Please ensure you are logged in to Canada Life.');
    }

    const cookies = extractCookies();
    const endpoint = 'https://my.canadalife.com/s/sfsites/aura?r=13&aura.ApexAction.execute=1';

    // Build the form data
    const formData = new URLSearchParams();
    formData.append('message', JSON.stringify(payload));
    formData.append('aura.context', '{"mode":"PROD","fwuid":"eE5UbjZPdVlRT3M0d0xtOXc5MzVOQWg5TGxiTHU3MEQ5RnBMM0VzVXc1cmcxMi42MjkxNDU2LjE2Nzc3MjE2","app":"siteforce:communityApp","loaded":{"APPLICATION@markup://siteforce:communityApp":"1304_mrTwQgpga20ubVtg_n_l_A"},"dn":[],"globals":{},"uad":true}');
    formData.append('aura.pageURI', '/s/activity-reports');
    formData.append('aura.token', auraToken);

    debugLog('Making Aura API call to Canada Life', { 
      endpoint, 
      payload,
      isRetry,
      tokenPreview: auraToken ? `${auraToken.substring(0, 10)}...` : 'null'
    });

    const response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'accept': '*/*',
        'adrum': 'isAjax:true',
        'content-type': 'application/x-www-form-urlencoded; charset=UTF-8',
        'origin': 'https://my.canadalife.com',
        'cookie': cookies
      },
      body: formData.toString(),
      signal: options.signal // Add abort signal support
    });

    debugLog('Response status details:', {
      status: response.status,
      statusText: response.statusText,
      ok: response.ok,
      url: response.url
    });

    if (!response.ok) {
      throw new Error(`Aura API call failed: ${response.status} ${response.statusText}`);
    }

    // Get raw response text first for debugging
    const rawResponse = await response.text();
    
    debugLog('Raw response analysis:', {
      contentType: response.headers.get('content-type'),
      contentLength: response.headers.get('content-length'),
      responseSize: rawResponse.length,
      responseStart: rawResponse.substring(0, 300), // First 300 chars
      responseEnd: rawResponse.substring(Math.max(0, rawResponse.length - 200)), // Last 200 chars
      startsWithComment: rawResponse.startsWith('/*'),
      endsWithComment: rawResponse.endsWith('*/'),
      headers: Object.fromEntries(response.headers.entries())
    });

    // Try to clean the response if it's wrapped in comments (common in Aura/Salesforce APIs)
    let cleanResponse = rawResponse;
    
    // Remove /*-secure- prefix and */ suffix if present
    if (rawResponse.startsWith('/*-secure-')) {
      const startIndex = rawResponse.indexOf('\n') + 1;
      const endIndex = rawResponse.lastIndexOf('*/');
      if (startIndex > 0 && endIndex > startIndex) {
        cleanResponse = rawResponse.substring(startIndex, endIndex);
        debugLog('Cleaned response from /*-secure- wrapper');
      }
    } 
    // Remove generic /* */ wrapper if present
    else if (rawResponse.startsWith('/*') && rawResponse.endsWith('*/')) {
      cleanResponse = rawResponse.slice(2, -2);
      debugLog('Cleaned response from /* */ wrapper');
    }

    debugLog('Cleaned response preview:', {
      originalLength: rawResponse.length,
      cleanedLength: cleanResponse.length,
      cleanedStart: cleanResponse.substring(0, 200)
    });

    let responseData;
    try {
      responseData = JSON.parse(cleanResponse);
      debugLog('Successfully parsed JSON response');
    } catch (parseError) {
      debugLog('JSON parse failed on cleaned response:', {
        error: parseError.message,
        cleanedResponsePreview: cleanResponse.substring(0, 500)
      });
      
      // Try parsing the original raw response as fallback
      try {
        responseData = JSON.parse(rawResponse);
        debugLog('Successfully parsed original raw response');
      } catch (originalParseError) {
        debugLog('Failed to parse both cleaned and raw responses:', {
          cleanedError: parseError.message,
          originalError: originalParseError.message
        });
        throw new Error(`Failed to parse API response as JSON. Original error: ${originalParseError.message}`);
      }
    }

    debugLog('Aura API response parsed successfully:', responseData);
    
    // Check for API-level errors before processing response
    try {
      responseData = checkApiResponseForErrors(responseData, auraToken);
    } catch (error) {
      if (error instanceof CanadaLifeTokenExpiredError && !isRetry && error.recoverable) {
        // Token expired but we have a fresh token available - retry once
        debugLog('Token expired, attempting retry with fresh token');
        toast.show('Token expired, retrying with fresh token...', 'info');
        
        // Mark this as a retry and call recursively
        const retryOptions = { ...options, isRetry: true };
        return await makeAuraApiCall(payload, retryOptions);
      }
      
      // For unrecoverable token errors or other API errors, show user-friendly message
      if (error instanceof CanadaLifeTokenExpiredError && !error.recoverable) {
        toast.show(error.message, 'error');
      } else if (error instanceof CanadaLifeApiError) {
        toast.show(error.message, 'error');
      }
      
      // Re-throw the error to maintain existing error handling flow
      throw error;
    }
    
    // Optionally extract nested response from returnValue.returnValue
    if (options.extractNestedResponse) {
      if (!responseData.actions || !responseData.actions[0] || !responseData.actions[0].returnValue) {
        throw new Error('Invalid response format from Canada Life API');
      }

      const returnValue = responseData.actions[0].returnValue.returnValue;
      if (!returnValue) {
        throw new Error('No return value in Canada Life API response');
      }

      // Parse the nested JSON
      const nestedData = JSON.parse(returnValue);
      debugLog('Extracted nested response data:', nestedData);
      
      // Check the nested data for errors too
      try {
        checkApiResponseForErrors(nestedData, auraToken);
      } catch (error) {
        if (error instanceof CanadaLifeTokenExpiredError && !isRetry && error.recoverable) {
          // Token expired but we have a fresh token available - retry once
          debugLog('Token expired in nested response, attempting retry with fresh token');
          toast.show('Token expired, retrying with fresh token...', 'info');
          
          // Mark this as a retry and call recursively
          const retryOptions = { ...options, isRetry: true };
          return await makeAuraApiCall(payload, retryOptions);
        }
        
        // For unrecoverable token errors or other API errors, show user-friendly message
        if (error instanceof CanadaLifeTokenExpiredError && !error.recoverable) {
          toast.show(error.message, 'error');
        } else if (error instanceof CanadaLifeApiError) {
          toast.show(error.message, 'error');
        }
        
        // Re-throw the error to maintain existing error handling flow
        throw error;
      }
      
      return nestedData;
    }
    
    return responseData;
  } catch (error) {
    debugLog('Error making Aura API call:', error);
    
    // Add context about retry status to error messages
    if (!isRetry && error instanceof CanadaLifeTokenExpiredError) {
      debugLog('Token error on initial attempt, retry logic will handle if token is refreshable');
    } else if (isRetry) {
      debugLog('Error occurred during retry attempt, no further retries will be attempted');
    }
    
    throw error;
  }
}
/**
 * Check if a date is a weekend (Saturday or Sunday)
 * @param {Date} date - Date object to check
 * @returns {boolean} True if weekend, false otherwise
 */
function isWeekend(date) {
  const dayOfWeek = date.getDay();
  return dayOfWeek === 0 || dayOfWeek === 6; // 0 = Sunday, 6 = Saturday
}

/**
 * Generate array of business days (excluding weekends) between start and end dates
 * @param {string} startDate - Start date in YYYY-MM-DD format
 * @param {string} endDate - End date in YYYY-MM-DD format
 * @returns {Array<string>} Array of business day date strings in YYYY-MM-DD format
 */
function generateBusinessDays(startDate, endDate) {
  const businessDays = [];
  const current = new Date(startDate);
  const end = new Date(endDate);

  while (current <= end) {
    if (!isWeekend(current)) {
      businessDays.push(current.toISOString().split('T')[0]);
    }
    current.setDate(current.getDate() + 1);
  }

  return businessDays;
}

/**
 * Load historical account balance data for a date range
 * Optimizes API calls by leveraging opening balance = previous day's closing balance
 * Skips weekends when balances don't change
 * @param {Object} account - Canada Life account object
 * @param {string} startDate - Start date in YYYY-MM-DD format
 * @param {string} endDate - End date in YYYY-MM-DD format
 * @param {Function} progressCallback - Optional progress callback function(current, total, percentage)
 * @param {AbortSignal} signal - Optional abort signal for cancellation support
 * @returns {Promise<Object>} Historical balance data with array format including headers
 */
export async function loadAccountBalanceHistory(account, startDate, endDate, progressCallback = null, signal = null) {
  try {
    debugLog('Loading historical account balance:', { 
      account: account.EnglishShortName, 
      startDate, 
      endDate 
    });
    
    // Validate inputs
    if (!account || !account.EnglishShortName || !account.agreementId) {
      throw new Error('Invalid account object provided');
    }
    
    if (!startDate || !/^\d{4}-\d{2}-\d{2}$/.test(startDate)) {
      throw new Error('Start date must be in YYYY-MM-DD format');
    }
    
    if (!endDate || !/^\d{4}-\d{2}-\d{2}$/.test(endDate)) {
      throw new Error('End date must be in YYYY-MM-DD format');
    }

    if (new Date(startDate) > new Date(endDate)) {
      throw new Error('Start date must be before or equal to end date');
    }

    // Generate business days only
    const businessDays = generateBusinessDays(startDate, endDate);
    
    if (businessDays.length === 0) {
      throw new Error('No business days found in the specified date range');
    }

    debugLog(`Generated ${businessDays.length} business days to process`);

    // Initialize result array with header row
    const data = [["Date", "Closing Balance", "Account Name"]];
    let apiCallsMade = 0;

    // Special case: single day
    if (businessDays.length === 1) {
      if (progressCallback) {
        progressCallback(0, 1, 0);
      }
      
      const balanceData = await loadAccountBalance(account, businessDays[0]);
      apiCallsMade = 1;
      data.push([
        balanceData.date,
        balanceData.closingBalance,
        account.EnglishShortName
      ]);
      
      if (progressCallback) {
        progressCallback(1, 1, 100);
      }
    } else {
      // Optimize API calls: process every other day to get 2 days of data per call
      for (let i = 0; i < businessDays.length; i += 2) {
        // Check for cancellation before each API call
        if (signal?.aborted) {
          throw new Error('Operation cancelled by user');
        }

        const currentDate = businessDays[i];
        const nextDate = businessDays[i + 1];

        try {
          // Update progress before making API call
          if (progressCallback) {
            const currentProgress = Math.min(i + 1, businessDays.length);
            const percentage = Math.round((currentProgress / businessDays.length) * 100);
            progressCallback(currentProgress, businessDays.length, percentage);
          }

          // Make API call for current date with signal support
          const balanceData = await loadAccountBalance(account, currentDate, signal);
          apiCallsMade++;

          // Add previous day's balance if we have opening balance and this isn't the first day
          if (i > 0) {
            // The opening balance for current date is the closing balance for the previous business day
            const prevBusinessDay = businessDays[i - 1];
            data.push([
              prevBusinessDay,
              balanceData.openingBalance,
              account.EnglishShortName
            ]);
          }

          // Add current day's closing balance
          data.push([
            currentDate,
            balanceData.closingBalance,
            account.EnglishShortName
          ]);

          // If there's a next day and we haven't processed it yet
          if (nextDate && i + 1 < businessDays.length) {
            // The opening balance for next date would be today's closing balance
            // We'll add next day's data in the next iteration or handle edge case below
          }

        } catch (error) {
          debugLog(`Error loading balance for ${currentDate}:`, error);
          // Continue processing other dates, but log the error
          toast.show(`Warning: Could not load balance for ${currentDate}`, 'warning');
        }
      }

      // Handle the case where we have an odd number of business days
      // The last day might not have been processed if we increment by 2
      const lastDayIndex = businessDays.length - 1;
      const lastDay = businessDays[lastDayIndex];
      
      // Check if last day was already processed
      const lastDayProcessed = data.some(row => row[0] === lastDay);
      
      if (!lastDayProcessed && businessDays.length > 1) {
        try {
          // Update progress for final day
          if (progressCallback) {
            progressCallback(businessDays.length, businessDays.length, 100);
          }
          
          const balanceData = await loadAccountBalance(account, lastDay);
          apiCallsMade++;
          
          data.push([
            lastDay,
            balanceData.closingBalance,
            account.EnglishShortName
          ]);
        } catch (error) {
          debugLog(`Error loading balance for last day ${lastDay}:`, error);
          toast.show(`Warning: Could not load balance for ${lastDay}`, 'warning');
        }
      } else if (progressCallback) {
        // Ensure progress shows 100% completion
        progressCallback(businessDays.length, businessDays.length, 100);
      }
    }

    // Sort data by date (skip header row)
    const headerRow = data[0];
    const dataRows = data.slice(1);
    dataRows.sort((a, b) => new Date(a[0]) - new Date(b[0]));
    const sortedData = [headerRow, ...dataRows];

    const result = {
      data: sortedData,
      account: {
        shortName: account.EnglishShortName,
        name: account.LongNameEnglish || account.EnglishShortName,
        agreementId: account.agreementId
      },
      dateRange: {
        startDate,
        endDate
      },
      totalDays: businessDays.length,
      apiCallsMade: apiCallsMade
    };

    debugLog('Successfully loaded historical account balance:', {
      account: account.EnglishShortName,
      totalDays: result.totalDays,
      apiCallsMade: result.apiCallsMade,
      optimizationRatio: `${Math.round((1 - apiCallsMade / businessDays.length) * 100)}% fewer API calls`
    });

    return result;

  } catch (error) {
    debugLog('Error loading historical account balance:', error);
    throw error;
  }
}

/**
 * Load account balance for a specific Canada Life account and date
 * @param {Object} account - Canada Life account object
 * @param {string} date - Date in YYYY-MM-DD format
 * @param {AbortSignal} signal - Optional abort signal for cancellation support
 * @returns {Promise<Object>} Balance data with opening and closing balances
 */
export async function loadAccountBalance(account, date, signal = null) {
  try {
    debugLog('Loading account balance:', { account: account.EnglishShortName, date });
    
    // Validate inputs
    if (!account || !account.EnglishShortName || !account.agreementId) {
      throw new Error('Invalid account object provided');
    }
    
    if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      throw new Error('Date must be in YYYY-MM-DD format');
    }

    // Build the Aura API payload for balance request
    const payload = {
      actions: [{
        id: "184;a",
        descriptor: "aura://ApexActionController/ACTION$execute",
        callingDescriptor: "UNKNOWN",
        params: {
          namespace: "vlocity_ins",
          classname: "BusinessProcessDisplayController",
          method: "GenericInvoke2NoCont",
          params: {
            input: JSON.stringify({
              startDate: date,
              endDate: date,
              planCode: account.EnglishShortName,
              grsAgreementId: account.agreementId
            }),
            options: "{}",
            sClassName: "vlocity_ins.IntegrationProcedureService",
            sMethodName: "grsa_GetActivityReportsByPlanCode"
          },
          cacheable: false,
          isContinuation: false
        }
      }]
    };

    debugLog('Balance API payload:', payload);

    // Make the API call with automatic nested response extraction and signal support
    const responseData = await makeAuraApiCall(payload, { 
      extractNestedResponse: true, 
      signal: signal 
    });

    // Validate response structure
    if (!responseData.IPResult) {
      throw new Error('No IPResult found in balance API response');
    }

    if (!responseData.IPResult.Summary) {
      throw new Error('No Summary found in balance API response');
    }

    const summary = responseData.IPResult.Summary;

    // Extract closing balance from Total.Value
    const closingBalance = summary.Total?.Value;
    if (typeof closingBalance !== 'number') {
      throw new Error('Could not extract closing balance from API response');
    }

    // Extract opening balance from Details array
    // Look for the entry that has a description starting with "Value of this plan on"
    let openingBalance = null;
    
    if (summary.Details && Array.isArray(summary.Details)) {
      // Try to find the opening balance by description pattern
      const openingEntry = summary.Details.find(detail => 
        detail.Description && detail.Description.toLowerCase().includes('value of this plan on')
      );
      
      if (openingEntry) {
        openingBalance = openingEntry.Value;
      } else {
        // Fallback to first Details entry if pattern match fails
        const firstDetail = summary.Details[0];
        if (firstDetail && typeof firstDetail.Value === 'number') {
          openingBalance = firstDetail.Value;
          debugLog('Using first Details entry as opening balance (pattern match failed)');
        }
      }
    }

    if (typeof openingBalance !== 'number') {
      throw new Error('Could not extract opening balance from API response');
    }

    const balanceData = {
      account: {
        name: account.LongNameEnglish || account.EnglishShortName,
        shortName: account.EnglishShortName,
        agreementId: account.agreementId
      },
      date: date,
      openingBalance: openingBalance,
      closingBalance: closingBalance,
      change: closingBalance - openingBalance,
      rawResponse: responseData // Include raw response for debugging
    };

    debugLog('Successfully loaded account balance:', balanceData);
    return balanceData;

  } catch (error) {
    debugLog('Error loading account balance:', error);
    throw error;
  }
}

/**
 * Load Canada Life accounts using the Aura API
 * @param {boolean} forceRefresh - Whether to force refresh from API (ignore cache)
 * @returns {Promise<Array>} Array of Canada Life accounts
 */
export async function loadCanadaLifeAccounts(forceRefresh = false) {
  const cacheKey = 'canadalife_accounts';
  
  try {
    // Check cache first (unless force refresh)
    if (!forceRefresh) {
      const cachedAccounts = GM_getValue(cacheKey, null);
      if (cachedAccounts) {
        const accounts = JSON.parse(cachedAccounts);
        debugLog(`Loaded ${accounts.length} Canada Life accounts from cache`);
        return accounts;
      }
    }

    debugLog('Loading Canada Life accounts from API...');
    toast.show('Loading Canada Life accounts...', 'info');

    // Build the Aura API payload
    const payload = {
      actions: [{
        id: "164;a",
        descriptor: "aura://ApexActionController/ACTION$execute",
        callingDescriptor: "UNKNOWN",
        params: {
          namespace: "vlocity_ins",
          classname: "BusinessProcessDisplayController",
          method: "GenericInvoke2NoCont",
          params: {
            input: '{"adminSystemId":"ENC_UFJELVBSSS0yMDEzLjA3LjMwLjE5LjQ5LjIxLjkzNjpKY3c2eGNRS2hyNmdPdG1FU01GQ2dRPT0"}',
            options: '{"useFuture":false,"preTransformBundle":"","postTransformBundle":"","chainable":false,"useQueueableApexRemoting":false,"ignoreCache":false,"ParentInteractionToken":"8f3d0b6d-15b3-4e23-83af-376780722803","vlcClass":"vlocity_ins.IntegrationProcedureService","useContinuation":false}',
            sClassName: "vlocity_ins.IntegrationProcedureService",
            sMethodName: "grsa_GetMemberPlans"
          },
          cacheable: false,
          isContinuation: false
        }
      }]
    };

    const response = await makeAuraApiCall(payload);

    // Parse the nested response structure
    if (!response.actions || !response.actions[0] || !response.actions[0].returnValue) {
      throw new Error('Invalid response format from Canada Life API');
    }

    const returnValue = response.actions[0].returnValue.returnValue;
    if (!returnValue) {
      throw new Error('No return value in Canada Life API response');
    }

    // Parse the nested JSON
    const nestedData = JSON.parse(returnValue);
    if (!nestedData.IPResult || !nestedData.IPResult.MemberPlans) {
      throw new Error('No MemberPlans found in Canada Life API response');
    }

    const accounts = nestedData.IPResult.MemberPlans;
    
    // Log account information for verification
    debugLog(`Loaded ${accounts.length} Canada Life accounts:`);
    accounts.forEach(account => {
      debugLog(`Account: ${account.LongNameEnglish} (${account.EnglishShortName})`, {
        agreementId: account.agreementId,
        enrollmentDate: account.EnrollmentDate,
        longName: account.LongNameEnglish,
        shortName: account.EnglishShortName
      });
    });

    // Cache the accounts permanently
    GM_setValue(cacheKey, JSON.stringify(accounts));
    
    // Show success notification
    const accountNames = accounts.map(acc => acc.EnglishShortName).join(', ');
    toast.show(`Loaded Canada Life accounts: ${accountNames}`, 'success');

    return accounts;
  } catch (error) {
    debugLog('Error loading Canada Life accounts:', error);
    toast.show(`Failed to load Canada Life accounts: ${error.message}`, 'error');
    throw error;
  }
}

// Export as default object
export default {
  getToken: getCanadaLifeToken,
  checkAuth: checkCanadaLifeAuth,
  checkTokenStatus,
  setupTokenMonitoring,
  extractCookies,
  makeAuraApiCall,
  loadCanadaLifeAccounts,
  loadAccountBalance,
  loadAccountBalanceHistory,
  // Export error classes for external use
  CanadaLifeTokenExpiredError,
  CanadaLifeApiError,
};
