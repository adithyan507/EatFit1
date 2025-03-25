// Utility functions for handling offline storage using IndexedDB

interface FoodEntry {
  id?: string;
  name: string;
  calories: number;
  protein: number;
  carbs: number;
  fat: number;
  date: Date;
  userId: string;
  synced?: boolean;
}

// Open the IndexedDB database
export async function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open('eatfitDB', 1);
    
    request.onupgradeneeded = (event: IDBVersionChangeEvent) => {
      const db = (event.target as IDBOpenDBRequest).result;
      
      // Create object stores if they don't exist
      if (!db.objectStoreNames.contains('foodEntries')) {
        const store = db.createObjectStore('foodEntries', { keyPath: 'id' });
        store.createIndex('userId', 'userId', { unique: false });
        store.createIndex('date', 'date', { unique: false });
        store.createIndex('synced', 'synced', { unique: false });
      }
    };
    
    request.onsuccess = (event: Event) => {
      resolve((event.target as IDBOpenDBRequest).result);
    };
    
    request.onerror = (event: Event) => {
      reject('Error opening IndexedDB database');
    };
  });
}

// Save a food entry to IndexedDB for offline storage
export async function saveFoodEntry(entry: FoodEntry): Promise<string> {
  try {
    const db = await openDatabase();
    return new Promise((resolve, reject) => {
      const transaction = db.transaction('foodEntries', 'readwrite');
      const store = transaction.objectStore('foodEntries');
      
      // Generate a unique ID if not provided
      if (!entry.id) {
        entry.id = `local_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
      }
      
      // Mark as not synced with server
      entry.synced = false;
      
      const request = store.add(entry);
      
      request.onsuccess = () => {
        resolve(entry.id as string);
        
        // Try to sync with server if online
        if (navigator.onLine) {
          syncWithServer();
        } else {
          // Register for background sync when online
          if ('serviceWorker' in navigator && 'SyncManager' in window) {
            navigator.serviceWorker.ready.then(registration => {
              registration.sync.register('foodEntrySync');
            });
          }
        }
      };
      
      request.onerror = () => {
        reject('Error saving food entry to IndexedDB');
      };
      
      transaction.oncomplete = () => {
        db.close();
      };
    });
  } catch (error) {
    console.error('Error in saveFoodEntry:', error);
    throw error;
  }
}

// Get food entries from IndexedDB
export async function getFoodEntries(userId: string, dayStart?: Date, dayEnd?: Date): Promise<FoodEntry[]> {
  try {
    const db = await openDatabase();
    return new Promise((resolve, reject) => {
      const transaction = db.transaction('foodEntries', 'readonly');
      const store = transaction.objectStore('foodEntries');
      const userIndex = store.index('userId');
      
      const request = userIndex.getAll(userId);
      
      request.onsuccess = (event: Event) => {
        let entries = (event.target as IDBRequest).result as FoodEntry[];
        
        // Filter by date range if specified
        if (dayStart && dayEnd) {
          entries = entries.filter(entry => {
            const entryDate = new Date(entry.date);
            return entryDate >= dayStart && entryDate < dayEnd;
          });
        }
        
        resolve(entries);
      };
      
      request.onerror = () => {
        reject('Error retrieving food entries from IndexedDB');
      };
      
      transaction.oncomplete = () => {
        db.close();
      };
    });
  } catch (error) {
    console.error('Error in getFoodEntries:', error);
    return [];
  }
}

// Sync offline entries with the server
export async function syncWithServer(): Promise<void> {
  if (!navigator.onLine) return;
  
  try {
    const db = await openDatabase();
    const transaction = db.transaction('foodEntries', 'readwrite');
    const store = transaction.objectStore('foodEntries');
    const syncIndex = store.index('synced');
    
    const unsyncedEntries = await new Promise<FoodEntry[]>((resolve, reject) => {
      const request = syncIndex.getAll(false);
      
      request.onsuccess = (event: Event) => {
        resolve((event.target as IDBRequest).result);
      };
      
      request.onerror = () => {
        reject('Error getting unsynced entries');
      };
    });
    
    // Sync each unsynced entry with the server
    for (const entry of unsyncedEntries) {
      try {
        // In a real app, this would be your API endpoint
        const response = await fetch('/api/foodEntries', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(entry),
        });
        
        if (response.ok) {
          // Update the entry as synced
          const updateTransaction = db.transaction('foodEntries', 'readwrite');
          const updateStore = updateTransaction.objectStore('foodEntries');
          entry.synced = true;
          updateStore.put(entry);
        }
      } catch (error) {
        console.error('Error syncing entry with server:', error);
      }
    }
    
    db.close();
  } catch (error) {
    console.error('Error in syncWithServer:', error);
  }
} 