# Cross-Device Settings Sync Design Document

## Monarch Uploader - Firebase Cloud Sync

**Version:** 1.0  
**Status:** Draft  
**Author:** AI Assistant  
**Date:** January 2026

---

## Table of Contents

1. [Executive Summary](#1-executive-summary)
2. [Architecture Overview](#2-architecture-overview)
3. [Data Model](#3-data-model)
4. [User Identification Strategy](#4-user-identification-strategy)
5. [What to Sync](#5-what-to-sync)
6. [Conflict Resolution Strategies](#6-conflict-resolution-strategies)
7. [Firebase Implementation Details](#7-firebase-implementation-details)
8. [Security Considerations](#8-security-considerations)
9. [Implementation Phases](#9-implementation-phases)
10. [Appendix](#10-appendix)

---

## 1. Executive Summary

### Goal
Enable automatic, seamless synchronization of Monarch Uploader settings and configuration across multiple devices without requiring manual user intervention beyond initial setup.

### Approach
Implement a cloud-based sync service using Firebase Realtime Database that automatically synchronizes configuration data between devices, with intelligent conflict resolution strategies appropriate to each data type.

### Key Benefits
- Users can use the extension on multiple computers (home, work, laptop) with consistent settings
- No data loss when switching devices
- Transaction deduplication lists stay synchronized to prevent duplicate uploads
- Account mappings persist across all devices

---

## 2. Architecture Overview

### High-Level Architecture

```
┌─────────────────┐     ┌─────────────────┐     ┌─────────────────┐
│    Device A     │     │    Firebase     │     │    Device B     │
│   (Userscript)  │────▶│ Realtime DB     │◀────│   (Userscript)  │
│                 │◀────│                 │────▶│                 │
└─────────────────┘     └─────────────────┘     └─────────────────┘
         │                       │                       │
         ▼                       ▼                       ▼
   ┌──────────┐           ┌──────────┐           ┌──────────┐
   │ Local    │           │ Cloud    │           │ Local    │
   │ Storage  │           │ Storage  │           │ Storage  │
   │(GM_*)    │           │(Firebase)│           │(GM_*)    │
   └──────────┘           └──────────┘           └──────────┘
```

### Sync Flow

```
1. User Action (e.g., maps account)
         │
         ▼
2. Local Storage Updated (GM_setValue)
         │
         ▼
3. Sync Manager Detects Change
         │
         ▼
4. Prepare Sync Payload with Metadata
         │
         ▼
5. Push to Firebase
         │
         ▼
6. Firebase Broadcasts to Other Devices
         │
         ▼
7. Other Devices Receive Update
         │
         ▼
8. Conflict Resolution (if needed)
         │
         ▼
9. Local Storage Updated on Other Devices
```

### Component Architecture

```
src/
├── services/
│   └── sync/
│       ├── index.js              # Main sync service entry point
│       ├── firebase-client.js    # Firebase SDK wrapper
│       ├── sync-manager.js       # Orchestrates sync operations
│       ├── conflict-resolver.js  # Conflict resolution strategies
│       ├── data-transformer.js   # Prepare data for sync
│       └── crdt/
│           ├── g-set.js          # Grow-only Set CRDT
│           ├── lww-register.js   # Last-Writer-Wins Register
│           └── or-set.js         # Observed-Remove Set CRDT
├── core/
│   └── sync-config.js            # Sync configuration constants
└── ui/
    └── components/
        └── syncStatusIndicator.js # UI for sync status
```

---

## 3. Data Model

### Firebase Database Structure

```javascript
{
  "users": {
    "{userHash}": {
      "metadata": {
        "lastSyncTimestamp": 1704556800000,
        "deviceCount": 2,
        "schemaVersion": 1
      },
      "settings": {
        // LWW Register - Simple settings
        "logLevel": {
          "value": "info",
          "timestamp": 1704556800000,
          "deviceId": "device_abc123"
        },
        "lookback": {
          "questrade": { "value": 3, "timestamp": 1704556800000, "deviceId": "..." },
          "canadalife": { "value": 3, "timestamp": 1704556800000, "deviceId": "..." },
          "rogersbank": { "value": 3, "timestamp": 1704556800000, "deviceId": "..." },
          "wealthsimple": { "value": 3, "timestamp": 1704556800000, "deviceId": "..." }
        },
        "retention": {
          "questrade": { "days": 91, "count": 1000, "timestamp": ..., "deviceId": ... },
          "rogersbank": { "days": 91, "count": 1000, "timestamp": ..., "deviceId": ... }
        }
      },
      "accountMappings": {
        // LWW Register per account
        "questrade": {
          "{accountId}": {
            "value": { /* Monarch account object */ },
            "timestamp": 1704556800000,
            "deviceId": "device_abc123",
            "deleted": false
          }
        },
        "canadalife": { ... },
        "rogersbank": { ... },
        "wealthsimple": { ... }
      },
      "categoryMappings": {
        // LWW Register per category
        "rogersbank": {
          "{bankCategory}": {
            "value": "monarch_category_id",
            "timestamp": 1704556800000,
            "deviceId": "device_abc123"
          }
        },
        "wealthsimple": { ... },
        "questrade": { ... }
      },
      "uploadedTransactions": {
        // G-Set CRDT - Grow-only set of transaction IDs
        "rogersbank": {
          "{accountId}": {
            "ids": {
              "ref_001": { "addedAt": 1704556800000, "addedBy": "device_abc123" },
              "ref_002": { "addedAt": 1704556801000, "addedBy": "device_def456" }
            },
            "metadata": {
              "count": 2,
              "lastUpdated": 1704556801000
            }
          }
        },
        "wealthsimple": {
          "{accountId}": { ... }
        }
      },
      "accountLists": {
        // OR-Set CRDT - Supports add and remove
        "wealthsimple": {
          "{accountId}": {
            "account": { /* Wealthsimple account data */ },
            "monarchMapping": { /* Optional Monarch account */ },
            "syncEnabled": true,
            "settings": {
              "storeTransactionDetailsInNotes": false,
              "stripStoreNumbers": true,
              "transactionRetentionDays": 91,
              "transactionRetentionCount": 1000
            },
            // CRDT metadata
            "_vector": {
              "device_abc123": 1,
              "device_def456": 2
            },
            "_tombstone": false,
            "_lastModified": 1704556800000
          }
        }
      },
      "uploadDates": {
        // LWW Register - but with MAX strategy (keep latest date)
        "questrade": {
          "{accountId}": {
            "value": "2024-01-06",
            "timestamp": 1704556800000,
            "deviceId": "device_abc123"
          }
        }
      }
    }
  }
}
```

### Local Storage Sync Metadata

Each synced value in local storage will have associated metadata:

```javascript
// Example: Storing sync metadata alongside values
GM_setValue('questrade_monarch_account_for_12345', {
  value: { /* Monarch account */ },
  _sync: {
    timestamp: 1704556800000,
    deviceId: 'device_abc123',
    version: 1,
    syncedAt: 1704556850000
  }
});
```

---

## 4. User Identification Strategy

### Approach: Monarch Token Hash

To maintain user privacy while enabling sync, we'll use a hash derived from the user's Monarch authentication:

```javascript
async function generateUserHash(monarchToken) {
  // Extract a stable identifier from the JWT token
  const tokenPayload = parseJwt(monarchToken);
  const userId = tokenPayload.sub || tokenPayload.user_id;
  
  // Create a SHA-256 hash for privacy
  const encoder = new TextEncoder();
  const data = encoder.encode(`monarch_uploader_sync_${userId}`);
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  const hashHex = hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
  
  return hashHex.substring(0, 32); // Use first 32 chars
}
```

### Device Identification

```javascript
function getOrCreateDeviceId() {
  let deviceId = GM_getValue('sync_device_id');
  if (!deviceId) {
    deviceId = `device_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    GM_setValue('sync_device_id', deviceId);
  }
  return deviceId;
}
```

### Why This Approach?

| Consideration | Solution |
|--------------|----------|
| No additional login | Uses existing Monarch auth |
| Privacy | Hash of user ID, not stored plainly |
| Unique per user | Monarch user IDs are unique |
| Stable | Same hash across devices with same Monarch account |

---

## 5. What to Sync

### ✅ Data TO Sync

| Data Type | Storage Key Pattern | Sync Strategy |
|-----------|-------------------|---------------|
| Account Mappings | `*_monarch_account_for_*` | LWW Register |
| Category Mappings | `*_category_mappings` | LWW Register |
| Uploaded Transaction IDs | `*_uploaded_refs_*`, `*_uploaded_orders_*` | G-Set CRDT |
| Lookback Settings | `*_lookback_days` | LWW Register |
| Retention Settings | `*_retention_*` | LWW Register |
| Account Lists | `*_accounts_list` | OR-Set CRDT |
| Upload Dates | `*_last_upload_date_*` | LWW-MAX Register |
| Log Level | `debug_log_level` | LWW Register |

### ❌ Data NOT to Sync

| Data Type | Reason |
|-----------|--------|
| `monarch_graphql_token` | Security - tokens should not traverse network |
| `wealthsimple_*_token` | Security - auth tokens are device-specific |
| `questrade_*_token` | Security - auth tokens are device-specific |
| `rogersbank_auth_token` | Security - auth tokens are device-specific |
| `sync_device_id` | Device-specific identifier |
| `canadalife_token` | Security - captured from localStorage |

### Sync Priority

```javascript
const SYNC_PRIORITY = {
  HIGH: ['accountMappings', 'categoryMappings'],     // Critical for operation
  MEDIUM: ['uploadedTransactions', 'accountLists'],   // Important for deduplication
  LOW: ['settings', 'uploadDates']                    // Nice to have
};
```

---

## 6. Conflict Resolution Strategies

### 6.1 Last-Writer-Wins (LWW) Register

**Concept:** The most recent write (by timestamp) always wins.

**Implementation:**

```javascript
class LWWRegister {
  constructor(initialValue = null) {
    this.value = initialValue;
    this.timestamp = 0;
    this.deviceId = null;
  }

  /**
   * Update the register with a new value
   * @param {any} newValue - The new value
   * @param {number} timestamp - Unix timestamp of the update
   * @param {string} deviceId - ID of the device making the update
   * @returns {boolean} - Whether the update was applied
   */
  update(newValue, timestamp, deviceId) {
    // Only update if the new timestamp is greater
    // Tie-breaker: use deviceId comparison for deterministic ordering
    if (timestamp > this.timestamp || 
        (timestamp === this.timestamp && deviceId > this.deviceId)) {
      this.value = newValue;
      this.timestamp = timestamp;
      this.deviceId = deviceId;
      return true;
    }
    return false;
  }

  /**
   * Merge with another LWW Register
   * @param {LWWRegister} other - Another register to merge
   * @returns {LWWRegister} - The merged register
   */
  merge(other) {
    const result = new LWWRegister();
    if (other.timestamp > this.timestamp ||
        (other.timestamp === this.timestamp && other.deviceId > this.deviceId)) {
      result.value = other.value;
      result.timestamp = other.timestamp;
      result.deviceId = other.deviceId;
    } else {
      result.value = this.value;
      result.timestamp = this.timestamp;
      result.deviceId = this.deviceId;
    }
    return result;
  }

  toJSON() {
    return {
      value: this.value,
      timestamp: this.timestamp,
      deviceId: this.deviceId
    };
  }

  static fromJSON(json) {
    const register = new LWWRegister();
    register.value = json.value;
    register.timestamp = json.timestamp;
    register.deviceId = json.deviceId;
    return register;
  }
}
```

**Use Cases:**
- Simple settings (log level, lookback days)
- Account mappings (a user sets up a mapping, it should apply everywhere)
- Category mappings

**Pros:**
- Simple to implement and understand
- Deterministic outcome
- Low overhead
- Works well with Firebase's built-in merge

**Cons:**
- Can lose data if updates happen simultaneously
- No merge of concurrent updates
- Clock synchronization issues (use server timestamp)

**Handling Clock Skew:**

```javascript
// Use Firebase server timestamp for consistency
import { serverTimestamp } from 'firebase/database';

async function setWithServerTimestamp(ref, value, deviceId) {
  return set(ref, {
    value: value,
    timestamp: serverTimestamp(),  // Firebase server time
    deviceId: deviceId
  });
}
```

---

### 6.2 Grow-Only Set (G-Set) CRDT

**Concept:** A set that can only grow; elements can be added but never removed. Perfect for transaction ID tracking where we never want to "forget" that a transaction was uploaded.

**Implementation:**

```javascript
class GSet {
  constructor() {
    this.elements = new Map(); // id -> { addedAt, addedBy }
  }

  /**
   * Add an element to the set
   * @param {string} element - Element to add
   * @param {number} timestamp - When it was added
   * @param {string} deviceId - Which device added it
   */
  add(element, timestamp = Date.now(), deviceId) {
    if (!this.elements.has(element)) {
      this.elements.set(element, {
        addedAt: timestamp,
        addedBy: deviceId
      });
      return true;
    }
    return false;
  }

  /**
   * Check if element exists in set
   * @param {string} element - Element to check
   */
  has(element) {
    return this.elements.has(element);
  }

  /**
   * Get all elements
   */
  values() {
    return Array.from(this.elements.keys());
  }

  /**
   * Merge with another G-Set
   * @param {GSet} other - Another G-Set to merge
   * @returns {GSet} - New merged G-Set
   */
  merge(other) {
    const result = new GSet();
    
    // Add all elements from this set
    for (const [element, metadata] of this.elements) {
      result.elements.set(element, { ...metadata });
    }
    
    // Add all elements from other set (union)
    for (const [element, metadata] of other.elements) {
      if (!result.elements.has(element)) {
        result.elements.set(element, { ...metadata });
      }
      // If both have it, keep the earlier addedAt timestamp
      else if (metadata.addedAt < result.elements.get(element).addedAt) {
        result.elements.set(element, { ...metadata });
      }
    }
    
    return result;
  }

  /**
   * Get count of elements
   */
  get size() {
    return this.elements.size;
  }

  toJSON() {
    const obj = {};
    for (const [element, metadata] of this.elements) {
      obj[element] = metadata;
    }
    return obj;
  }

  static fromJSON(json) {
    const set = new GSet();
    for (const [element, metadata] of Object.entries(json)) {
      set.elements.set(element, metadata);
    }
    return set;
  }
}
```

**Use Cases:**
- `rogersbank_uploaded_refs_*` - Transaction reference numbers
- `questrade_uploaded_orders_*` - Order UUIDs
- Any "uploaded transaction ID" tracking

**Why G-Set for Transactions?**

```
Device A uploads transactions [T1, T2, T3]
Device B uploads transactions [T2, T4, T5]

With G-Set merge:
Result = [T1, T2, T3, T4, T5]

This prevents:
- Re-uploading T2 (which both devices uploaded)
- Missing any uploaded transactions
```

**Pros:**
- Always converges to the same state
- No data loss
- Simple merge (union)
- Perfect for deduplication tracking

**Cons:**
- Can't remove elements (by design)
- Set grows unbounded (need cleanup strategy)

**Garbage Collection for G-Set:**

```javascript
class GSetWithGC extends GSet {
  /**
   * Create a compacted version based on retention policy
   * @param {number} retentionDays - Keep elements newer than this
   * @param {number} maxCount - Maximum elements to keep
   */
  compact(retentionDays = 91, maxCount = 1000) {
    const cutoffDate = Date.now() - (retentionDays * 24 * 60 * 60 * 1000);
    const result = new GSetWithGC();
    
    // Sort by addedAt descending
    const sorted = Array.from(this.elements.entries())
      .sort((a, b) => b[1].addedAt - a[1].addedAt);
    
    let count = 0;
    for (const [element, metadata] of sorted) {
      // Keep if within retention period OR within max count
      if (metadata.addedAt >= cutoffDate || count < maxCount) {
        result.elements.set(element, metadata);
        count++;
      }
    }
    
    return result;
  }
}
```

---

### 6.3 Observed-Remove Set (OR-Set) CRDT

**Concept:** A set that supports both add and remove operations with proper conflict resolution. Uses "unique tags" to track adds, allowing removes to only affect specific add operations.

**Implementation:**

```javascript
class ORSet {
  constructor() {
    // Map of element -> Map of (tag -> metadata)
    // Each add gets a unique tag
    this.elements = new Map();
    // Tombstone: Set of removed tags
    this.tombstones = new Set();
  }

  /**
   * Generate a unique tag for an add operation
   */
  _generateTag(deviceId, timestamp) {
    return `${deviceId}_${timestamp}_${Math.random().toString(36).substr(2, 9)}`;
  }

  /**
   * Add an element to the set
   * @param {string} element - Element to add
   * @param {string} deviceId - Device performing the add
   * @param {number} timestamp - Timestamp of the operation
   * @returns {string} - The tag for this add operation
   */
  add(element, deviceId, timestamp = Date.now()) {
    const tag = this._generateTag(deviceId, timestamp);
    
    if (!this.elements.has(element)) {
      this.elements.set(element, new Map());
    }
    
    this.elements.get(element).set(tag, {
      addedAt: timestamp,
      addedBy: deviceId
    });
    
    return tag;
  }

  /**
   * Remove an element from the set
   * Removes all current tags for this element
   * @param {string} element - Element to remove
   */
  remove(element) {
    if (this.elements.has(element)) {
      const tags = this.elements.get(element);
      for (const tag of tags.keys()) {
        this.tombstones.add(tag);
      }
      this.elements.delete(element);
    }
  }

  /**
   * Check if element is in the set
   */
  has(element) {
    return this.elements.has(element) && this.elements.get(element).size > 0;
  }

  /**
   * Get all elements in the set
   */
  values() {
    return Array.from(this.elements.keys()).filter(el => this.has(el));
  }

  /**
   * Merge with another OR-Set
   * @param {ORSet} other - Another OR-Set
   * @returns {ORSet} - Merged OR-Set
   */
  merge(other) {
    const result = new ORSet();
    
    // Union of all tombstones
    for (const tag of this.tombstones) {
      result.tombstones.add(tag);
    }
    for (const tag of other.tombstones) {
      result.tombstones.add(tag);
    }
    
    // For each element, union of tags minus tombstones
    const allElements = new Set([
      ...this.elements.keys(),
      ...other.elements.keys()
    ]);
    
    for (const element of allElements) {
      const thisTags = this.elements.get(element) || new Map();
      const otherTags = other.elements.get(element) || new Map();
      
      const mergedTags = new Map();
      
      // Add tags from this set (if not tombstoned)
      for (const [tag, metadata] of thisTags) {
        if (!result.tombstones.has(tag)) {
          mergedTags.set(tag, metadata);
        }
      }
      
      // Add tags from other set (if not tombstoned)
      for (const [tag, metadata] of otherTags) {
        if (!result.tombstones.has(tag)) {
          mergedTags.set(tag, metadata);
        }
      }
      
      if (mergedTags.size > 0) {
        result.elements.set(element, mergedTags);
      }
    }
    
    return result;
  }

  toJSON() {
    const elements = {};
    for (const [element, tags] of this.elements) {
      elements[element] = {};
      for (const [tag, metadata] of tags) {
        elements[element][tag] = metadata;
      }
    }
    return {
      elements,
      tombstones: Array.from(this.tombstones)
    };
  }

  static fromJSON(json) {
    const set = new ORSet();
    set.tombstones = new Set(json.tombstones || []);
    for (const [element, tags] of Object.entries(json.elements || {})) {
      set.elements.set(element, new Map(Object.entries(tags)));
    }
    return set;
  }
}
```

**Use Cases:**
- `wealthsimple_accounts_list` - Accounts can be added and removed
- Any list where users might delete entries

**Conflict Resolution Example:**

```
Initial state: accounts = {ACC1, ACC2}

Device A (offline): removes ACC2
Device B (offline): modifies ACC2's settings

After merge:
- ACC2 is removed (Device A's remove wins for ACC2's original tags)
- BUT if Device B re-added ACC2 with new tag during modification,
  that new add survives

This is the "add-wins" semantic - concurrent add and remove
results in the element being present.
```

**Pros:**
- Supports both add and remove
- Handles concurrent operations gracefully
- Eventually consistent
- Intuitive semantics (recent operations "win")

**Cons:**
- More complex implementation
- Tombstones can grow unbounded (need cleanup)
- Higher storage overhead

---

### 6.4 LWW-Element-Set

**Concept:** Each element has both add and remove timestamps. The operation with the higher timestamp wins.

**Implementation:**

```javascript
class LWWElementSet {
  constructor(bias = 'add') {
    this.addSet = new Map();    // element -> { timestamp, deviceId }
    this.removeSet = new Map(); // element -> { timestamp, deviceId }
    this.bias = bias; // 'add' or 'remove' for tie-breaking
  }

  add(element, timestamp = Date.now(), deviceId) {
    const current = this.addSet.get(element);
    if (!current || timestamp > current.timestamp ||
        (timestamp === current.timestamp && deviceId > current.deviceId)) {
      this.addSet.set(element, { timestamp, deviceId });
    }
  }

  remove(element, timestamp = Date.now(), deviceId) {
    const current = this.removeSet.get(element);
    if (!current || timestamp > current.timestamp ||
        (timestamp === current.timestamp && deviceId > current.deviceId)) {
      this.removeSet.set(element, { timestamp, deviceId });
    }
  }

  has(element) {
    const addTime = this.addSet.get(element);
    const removeTime = this.removeSet.get(element);
    
    if (!addTime) return false;
    if (!removeTime) return true;
    
    if (addTime.timestamp > removeTime.timestamp) return true;
    if (removeTime.timestamp > addTime.timestamp) return false;
    
    // Tie: use bias
    return this.bias === 'add';
  }

  values() {
    return Array.from(this.addSet.keys()).filter(el => this.has(el));
  }

  merge(other) {
    const result = new LWWElementSet(this.bias);
    
    // Merge add sets
    for (const [element, metadata] of this.addSet) {
      result.add(element, metadata.timestamp, metadata.deviceId);
    }
    for (const [element, metadata] of other.addSet) {
      result.add(element, metadata.timestamp, metadata.deviceId);
    }
    
    // Merge remove sets
    for (const [element, metadata] of this.removeSet) {
      result.remove(element, metadata.timestamp, metadata.deviceId);
    }
    for (const [element, metadata] of other.removeSet) {
      result.remove(element, metadata.timestamp, metadata.deviceId);
    }
    
    return result;
  }

  toJSON() {
    return {
      addSet: Object.fromEntries(this.addSet),
      removeSet: Object.fromEntries(this.removeSet),
      bias: this.bias
    };
  }

  static fromJSON(json) {
    const set = new LWWElementSet(json.bias);
    for (const [element, metadata] of Object.entries(json.addSet || {})) {
      set.addSet.set(element, metadata);
    }
    for (const [element, metadata] of Object.entries(json.removeSet || {})) {
      set.removeSet.set(element, metadata);
    }
    return set;
  }
}
```

**Use Cases:**
- Alternative to OR-Set for account lists
- When you want simpler implementation than OR-Set

**Pros:**
- Simpler than OR-Set
- No unbounded tombstone growth (old entries can be cleaned up)
- Clear semantics

**Cons:**
- Can lose concurrent adds/removes
- Requires careful timestamp management

---

### 6.5 LWW-MAX Register (Special Case)

**Concept:** For upload dates, we want to keep the MAXIMUM (most recent) date, not just the last-written value.

```javascript
class LWWMaxRegister {
  constructor() {
    this.value = null;
    this.timestamp = 0;
    this.deviceId = null;
  }

  update(newValue, timestamp, deviceId) {
    // Compare values, not timestamps
    // For dates, keep the later date
    const newDate = new Date(newValue);
    const currentDate = this.value ? new Date(this.value) : new Date(0);
    
    if (newDate > currentDate) {
      this.value = newValue;
      this.timestamp = timestamp;
      this.deviceId = deviceId;
      return true;
    }
    return false;
  }

  merge(other) {
    const result = new LWWMaxRegister();
    const thisDate = this.value ? new Date(this.value) : new Date(0);
    const otherDate = other.value ? new Date(other.value) : new Date(0);
    
    if (otherDate > thisDate) {
      result.value = other.value;
      result.timestamp = other.timestamp;
      result.deviceId = other.deviceId;
    } else {
      result.value = this.value;
      result.timestamp = this.timestamp;
      result.deviceId = this.deviceId;
    }
    return result;
  }
}
```

**Use Case:** Upload dates - we always want the most recent upload date across all devices to prevent re-uploading old transactions.

---

### 6.6 Conflict Resolution Summary

| Data Type | CRDT | Rationale |
|-----------|------|-----------|
| Simple settings | LWW Register | Simple, last edit wins |
| Account mappings | LWW Register | User edits are deliberate |
| Category mappings | LWW Register | Mappings shouldn't conflict often |
| Transaction IDs | G-Set | Never forget an upload, always merge |
| Account lists | OR-Set | Support add/remove with proper semantics |
| Upload dates | LWW-MAX | Keep most recent date |

---

## 7. Firebase Implementation Details

### 7.1 Firebase Project Setup

```javascript
// src/services/sync/firebase-client.js

import { initializeApp } from 'firebase/app';
import { 
  getDatabase, 
  ref, 
  set, 
  get, 
  onValue, 
  update,
  serverTimestamp 
} from 'firebase/database';

const firebaseConfig = {
  apiKey: "YOUR_API_KEY",
  authDomain: "monarch-uploader-sync.firebaseapp.com",
  databaseURL: "https://monarch-uploader-sync-default-rtdb.firebaseio.com",
  projectId: "monarch-uploader-sync",
  storageBucket: "monarch-uploader-sync.appspot.com",
  messagingSenderId: "YOUR_SENDER_ID",
  appId: "YOUR_APP_ID"
};

let app = null;
let database = null;

export function initializeFirebase() {
  if (!app) {
    app = initializeApp(firebaseConfig);
    database = getDatabase(app);
  }
  return { app, database };
}

export function getUserRef(userHash) {
  return ref(database, `users/${userHash}`);
}

export function getSettingsRef(userHash) {
  return ref(database, `users/${userHash}/settings`);
}

export function getAccountMappingsRef(userHash, institution) {
  return ref(database, `users/${userHash}/accountMappings/${institution}`);
}

export function getUploadedTransactionsRef(userHash, institution, accountId) {
  return ref(database, `users/${userHash}/uploadedTransactions/${institution}/${accountId}`);
}
```

### 7.2 Sync Manager

```javascript
// src/services/sync/sync-manager.js

import { onValue, set, update, get, serverTimestamp } from 'firebase/database';
import { 
  initializeFirebase, 
  getUserRef, 
  getSettingsRef,
  getAccountMappingsRef 
} from './firebase-client';
import { LWWRegister } from './crdt/lww-register';
import { GSet } from './crdt/g-set';
import { ORSet } from './crdt/or-set';

class SyncManager {
  constructor() {
    this.userHash = null;
    this.deviceId = null;
    this.listeners = new Map();
    this.syncEnabled = false;
    this.lastSyncTime = null;
    this.pendingChanges = [];
    this.isOnline = navigator.onLine;
  }

  /**
   * Initialize the sync manager
   * @param {string} monarchToken - User's Monarch token for identification
   */
  async initialize(monarchToken) {
    if (!monarchToken) {
      console.log('Sync: No Monarch token, sync disabled');
      return false;
    }

    try {
      this.userHash = await generateUserHash(monarchToken);
      this.deviceId = getOrCreateDeviceId();
      
      initializeFirebase();
      
      // Set up online/offline detection
      window.addEventListener('online', () => this.handleOnline());
      window.addEventListener('offline', () => this.handleOffline());
      
      // Perform initial sync
      await this.performInitialSync();
      
      // Set up real-time listeners
      this.setupListeners();
      
      this.syncEnabled = true;
      console.log('Sync: Initialized successfully');
      return true;
    } catch (error) {
      console.error('Sync: Initialization failed', error);
      return false;
    }
  }

  /**
   * Perform initial sync - pull remote state and merge with local
   */
  async performInitialSync() {
    const userRef = getUserRef(this.userHash);
    const snapshot = await get(userRef);
    
    if (snapshot.exists()) {
      const remoteData = snapshot.val();
      await this.mergeRemoteToLocal(remoteData);
    } else {
      // First device - push local state to remote
      await this.pushLocalToRemote();
    }
    
    this.lastSyncTime = Date.now();
  }

  /**
   * Merge remote data to local storage
   */
  async mergeRemoteToLocal(remoteData) {
    // Merge settings
    if (remoteData.settings) {
      await this.mergeSettings(remoteData.settings);
    }
    
    // Merge account mappings
    if (remoteData.accountMappings) {
      await this.mergeAccountMappings(remoteData.accountMappings);
    }
    
    // Merge uploaded transactions (G-Set merge)
    if (remoteData.uploadedTransactions) {
      await this.mergeUploadedTransactions(remoteData.uploadedTransactions);
    }
    
    // Merge account lists (OR-Set merge)
    if (remoteData.accountLists) {
      await this.mergeAccountLists(remoteData.accountLists);
    }
  }

  /**
   * Set up real-time listeners for remote changes
   */
  setupListeners() {
    const userRef = getUserRef(this.userHash);
    
    const unsubscribe = onValue(userRef, (snapshot) => {
      if (snapshot.exists()) {
        const data = snapshot.val();
        this.handleRemoteUpdate(data);
      }
    });
    
    this.listeners.set('user', unsubscribe);
  }

  /**
   * Handle a remote update from Firebase
   */
  async handleRemoteUpdate(data) {
    // Skip if this update was from our own device
    if (data.metadata?.lastDeviceId === this.deviceId) {
      return;
    }
    
    await this.mergeRemoteToLocal(data);
    
    // Emit event for UI to update
    window.dispatchEvent(new CustomEvent('sync:updated', { detail: data }));
  }

  /**
   * Push a local change to Firebase
   */
  async pushChange(path, value, crdtType = 'lww') {
    if (!this.syncEnabled) {
      this.pendingChanges.push({ path, value, crdtType, timestamp: Date.now() });
      return;
    }

    const timestamp = Date.now();
    
    const syncPayload = {
      value: value,
      timestamp: serverTimestamp(),
      deviceId: this.deviceId
    };

    try {
      const ref = ref(database, `users/${this.userHash}/${path}`);
      await set(ref, syncPayload);
      
      // Update metadata
      await update(getUserRef(this.userHash), {
        'metadata/lastSyncTimestamp': serverTimestamp(),
        'metadata/lastDeviceId': this.deviceId
      });
    } catch (error) {
      console.error('Sync: Failed to push change', error);
      this.pendingChanges.push({ path, value, crdtType, timestamp });
    }
  }

  /**
   * Handle coming back online
   */
  async handleOnline() {
    this.isOnline = true;
    console.log('Sync: Back online, syncing pending changes');
    
    // Push any pending changes
    for (const change of this.pendingChanges) {
      await this.pushChange(change.path, change.value, change.crdtType);
    }
    this.pendingChanges = [];
    
    // Refresh from remote
    await this.performInitialSync();
  }

  /**
   * Handle going offline
   */
  handleOffline() {
    this.isOnline = false;
    console.log('Sync: Offline, changes will be queued');
  }

  /**
   * Clean up listeners
   */
  destroy() {
    for (const unsubscribe of this.listeners.values()) {
      unsubscribe();
    }
    this.listeners.clear();
    this.syncEnabled = false;
  }
}

export const syncManager = new SyncManager();
```

### 7.3 Storage Wrapper with Sync

```javascript
// src/services/sync/synced-storage.js

import { syncManager } from './sync-manager';
import { STORAGE } from '../../core/config';

// Keys that should be synced
const SYNCABLE_KEYS = {
  // LWW Register
  [STORAGE.QUESTRADE_LOOKBACK_DAYS]: { type: 'lww', path: 'settings/lookback/questrade' },
  [STORAGE.CANADALIFE_LOOKBACK_DAYS]: { type: 'lww', path: 'settings/lookback/canadalife' },
  [STORAGE.ROGERSBANK_LOOKBACK_DAYS]: { type: 'lww', path: 'settings/lookback/rogersbank' },
  [STORAGE.WEALTHSIMPLE_LOOKBACK_DAYS]: { type: 'lww', path: 'settings/lookback/wealthsimple' },
  'debug_log_level': { type: 'lww', path: 'settings/logLevel' },
  
  // Category mappings (LWW)
  [STORAGE.ROGERSBANK_CATEGORY_MAPPINGS]: { type: 'lww', path: 'categoryMappings/rogersbank' },
  [STORAGE.WEALTHSIMPLE_CATEGORY_MAPPINGS]: { type: 'lww', path: 'categoryMappings/wealthsimple' },
  [STORAGE.QUESTRADE_ORDER_CATEGORY_MAPPINGS]: { type: 'lww', path: 'categoryMappings/questrade' },
};

// Prefixes that should be synced with their CRDT type
const SYNCABLE_PREFIXES = {
  [STORAGE.QUESTRADE_ACCOUNT_MAPPING_PREFIX]: { type: 'lww', basePath: 'accountMappings/questrade' },
  [STORAGE.CANADALIFE_ACCOUNT_MAPPING_PREFIX]: { type: 'lww', basePath: 'accountMappings/canadalife' },
  [STORAGE.ROGERSBANK_ACCOUNT_MAPPING_PREFIX]: { type: 'lww', basePath: 'accountMappings/rogersbank' },
  [STORAGE.ROGERSBANK_UPLOADED_REFS_PREFIX]: { type: 'gset', basePath: 'uploadedTransactions/rogersbank' },
  [STORAGE.QUESTRADE_UPLOADED_ORDERS_PREFIX]: { type: 'gset', basePath: 'uploadedTransactions/questrade' },
  [STORAGE.QUESTRADE_LAST_UPLOAD_DATE_PREFIX]: { type: 'lww-max', basePath: 'uploadDates/questrade' },
  [STORAGE.CANADALIFE_LAST_UPLOAD_DATE_PREFIX]: { type: 'lww-max', basePath: 'uploadDates/canadalife' },
  [STORAGE.ROGERSBANK_LAST_UPLOAD_DATE_PREFIX]: { type: 'lww-max', basePath: 'uploadDates/rogersbank' },
};

/**
 * Synced wrapper for GM_setValue
 */
export function syncedSetValue(key, value) {
  // Always set locally first
  GM_setValue(key, value);
  
  // Check if this key should be synced
  const syncConfig = getSyncConfig(key);
  if (syncConfig) {
    syncManager.pushChange(syncConfig.path, value, syncConfig.type);
  }
}

/**
 * Get sync configuration for a storage key
 */
function getSyncConfig(key) {
  // Check exact match
  if (SYNCABLE_KEYS[key]) {
    return SYNCABLE_KEYS[key];
  }
  
  // Check prefix match
  for (const [prefix, config] of Object.entries(SYNCABLE_PREFIXES)) {
    if (key.startsWith(prefix)) {
      const suffix = key.replace(prefix, '');
      return {
        type: config.type,
        path: `${config.basePath}/${suffix}`
      };
    }
  }
  
  return null;
}

/**
 * Synced wrapper for GM_getValue with fallback to sync
 */
export function syncedGetValue(key, defaultValue) {
  return GM_getValue(key, defaultValue);
}

/**
 * Synced wrapper for GM_deleteValue
 */
export function syncedDeleteValue(key) {
  GM_deleteValue(key);
  
  const syncConfig = getSyncConfig(key);
  if (syncConfig) {
    // For LWW, mark as deleted
    syncManager.pushChange(syncConfig.path, { _deleted: true, _deletedAt: Date.now() }, syncConfig.type);
  }
}
```

### 7.4 Firebase Security Rules

```json
{
  "rules": {
    "users": {
      "$userHash": {
        // Only allow read/write if the request contains valid metadata
        ".read": true,
        ".write": true,
        
        "metadata": {
          ".validate": "newData.hasChildren(['lastSyncTimestamp', 'schemaVersion'])"
        },
        
        "settings": {
          ".validate": true
        },
        
        "accountMappings": {
          "$institution": {
            "$accountId": {
              ".validate": "newData.hasChildren(['value', 'timestamp', 'deviceId'])"
            }
          }
        },
        
        "uploadedTransactions": {
          "$institution": {
            "$accountId": {
              "ids": {
                "$transactionId": {
                  ".validate": "newData.hasChildren(['addedAt', 'addedBy'])"
                }
              }
            }
          }
        }
      }
    }
  }
}
```

---

## 8. Security Considerations

### 8.1 Data Privacy

| Concern | Mitigation |
|---------|------------|
| User identification | Use hashed Monarch user ID, not plain text |
| Sensitive data exposure | Never sync auth tokens |
| Data at rest | Firebase data is encrypted at rest by default |
| Data in transit | All Firebase communications use TLS |

### 8.2 What NOT to Sync

**Critical: These must NEVER be synced:**

```javascript
const NEVER_SYNC = [
  STORAGE.MONARCH_TOKEN,           // Auth token
  STORAGE.WEALTHSIMPLE_ACCESS_TOKEN,  // Auth token
  STORAGE.WEALTHSIMPLE_AUTH_TOKEN,    // Auth token
  STORAGE.ROGERSBANK_AUTH_TOKEN,      // Auth token
  'sync_device_id',                   // Device-specific
  // Any localStorage tokens (CanadaLife)
];
```

### 8.3 Firebase Authentication

For production, consider adding Firebase Authentication:

```javascript
// Option 1: Anonymous auth (simplest)
import { getAuth, signInAnonymously } from 'firebase/auth';

async function authenticateFirebase() {
  const auth = getAuth();
  const userCredential = await signInAnonymously(auth);
  return userCredential.user.uid;
}

// Option 2: Custom token from Monarch (more secure)
// Would require a backend to validate Monarch token and issue Firebase token
```

### 8.4 Rate Limiting

```javascript
// Debounce rapid writes
const SYNC_DEBOUNCE_MS = 1000;
let syncTimeout = null;
let pendingSync = null;

function debouncedSync(path, value) {
  pendingSync = { path, value };
  
  if (syncTimeout) {
    clearTimeout(syncTimeout);
  }
  
  syncTimeout = setTimeout(() => {
    syncManager.pushChange(pendingSync.path, pendingSync.value);
    pendingSync = null;
    syncTimeout = null;
  }, SYNC_DEBOUNCE_MS);
}
```

### 8.5 Data Validation

```javascript
// Validate incoming sync data before applying
function validateSyncData(data, schema) {
  // Check schema version compatibility
  if (data.metadata?.schemaVersion > CURRENT_SCHEMA_VERSION) {
    console.warn('Sync: Newer schema version detected, some data may not sync correctly');
  }
  
  // Validate data structure
  if (!data.timestamp || !data.deviceId) {
    throw new Error('Invalid sync data: missing required fields');
  }
  
  // Validate value types based on expected schema
  // ...
}
```

---

## 9. Implementation Phases

### Phase 1: Foundation (Week 1-2)

**Goals:**
- Set up Firebase project
- Implement CRDT classes
- Create sync manager core

**Tasks:**
- [ ] Create Firebase project and configure security rules
- [ ] Implement LWW Register CRDT
- [ ] Implement G-Set CRDT
- [ ] Create basic sync manager
- [ ] Add user hash generation
- [ ] Add device ID management

**Deliverables:**
- Working CRDT implementations with tests
- Basic sync manager that can push/pull data

### Phase 2: Storage Integration (Week 3-4)

**Goals:**
- Integrate sync with existing storage
- Handle offline scenarios

**Tasks:**
- [ ] Create synced storage wrapper
- [ ] Map existing storage keys to sync paths
- [ ] Implement offline queue
- [ ] Add online/offline detection
- [ ] Create migration for existing data

**Deliverables:**
- Storage wrapper that syncs transparently
- Offline support with queue

### Phase 3: Conflict Resolution (Week 5-6)

**Goals:**
- Implement all conflict resolution strategies
- Test edge cases

**Tasks:**
- [ ] Implement OR-Set CRDT
- [ ] Implement LWW-MAX for upload dates
- [ ] Add conflict resolution for account lists
- [ ] Add garbage collection for G-Sets
- [ ] Comprehensive testing of merge scenarios

**Deliverables:**
- All CRDT types implemented
- Edge cases handled

### Phase 4: UI & Polish (Week 7-8)

**Goals:**
- Add sync status UI
- Settings modal integration
- Error handling

**Tasks:**
- [ ] Create sync status indicator component
- [ ] Add sync settings to settings modal
- [ ] Implement sync enable/disable toggle
- [ ] Add error notifications for sync failures
- [ ] Add sync history/debug view

**Deliverables:**
- User-visible sync status
- Sync configuration options

### Phase 5: Testing & Launch (Week 9-10)

**Goals:**
- Comprehensive testing
- Documentation
- Gradual rollout

**Tasks:**
- [ ] Unit tests for all sync components
- [ ] Integration tests for full sync flow
- [ ] Multi-device testing
- [ ] Performance testing
- [ ] Update user documentation
- [ ] Gradual rollout (opt-in first)

**Deliverables:**
- Production-ready sync feature
- User documentation

---

## 10. Appendix

### A. Firebase Costs Estimation

Firebase Realtime Database free tier:
- 1 GB storage
- 10 GB/month download
- 100 simultaneous connections

**Estimated usage per user:**
- Settings: ~1 KB
- Account mappings: ~10 KB
- Transaction IDs (1000): ~50 KB
- Total per user: ~100 KB

**Free tier capacity:** ~10,000 active users

For scale beyond free tier:
- Pay-as-you-go: $5/GB stored, $1/GB downloaded

### B. Alternative Sync Backends

**Supabase (PostgreSQL)**
- Pros: SQL queries, more flexible schema
- Cons: More complex setup, higher latency

**Firebase Firestore**
- Pros: Better querying, offline support built-in
- Cons: Higher cost for frequent writes

**Custom Backend (Node.js + Redis)**
- Pros: Full control, custom logic
- Cons: Requires hosting, more development

### C. CRDT Resources

- [A comprehensive study of CRDTs](https://hal.inria.fr/inria-00555588/document)
- [CRDT.tech](https://crdt.tech/)
- [Automerge - CRDT library](https://automerge.org/)
- [Yjs - CRDT implementation](https://yjs.dev/)

### D. Testing Scenarios

**Scenario 1: Basic Sync**
1. User adds account mapping on Device A
2. Device B receives update
3. Verify mapping appears on Device B

**Scenario 2: Offline Sync**
1. Device A goes offline
2. User changes settings on Device A
3. User changes same settings on Device B
4. Device A comes online
5. Verify LWW resolution works correctly

**Scenario 3: Transaction ID Merge**
1. Device A uploads transactions [T1, T2]
2. Device B uploads transactions [T2, T3]
3. Sync occurs
4. Verify both devices have [T1, T2, T3]

**Scenario 4: Account List Remove**
1. Device A removes account ACC1
2. Device B modifies account ACC1 settings
3. Sync occurs
4. Verify OR-Set semantics (add wins)

### E. Migration Strategy

For users with existing local data:

```javascript
async function migrateExistingData() {
  // Check if already migrated
  if (GM_getValue('sync_migration_complete')) {
    return;
  }
  
  // Get all existing keys
  const allKeys = GM_listValues();
  
  // For each syncable key, push to remote
  for (const key of allKeys) {
    const syncConfig = getSyncConfig(key);
    if (syncConfig) {
      const value = GM_getValue(key);
      await syncManager.pushChange(syncConfig.path, value, syncConfig.type);
    }
  }
  
  GM_setValue('sync_migration_complete', true);
  GM_setValue('sync_migration_date', Date.now());
}
```

---

## Document History

| Version | Date | Changes |
|---------|------|---------|
| 1.0 | January 2026 | Initial draft |

---

*End of Design Document*
