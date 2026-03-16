"use client";

import type {
  DeviceAttendanceHistoryItem,
  QueuedAttendanceSubmission,
} from "@/types/attendance";

const DB_NAME = "ciss-attendance-offline";
const DB_VERSION = 1;
const QUEUE_STORE = "queue";
const HISTORY_STORE = "history";
const SINGLETON_KEY = "singleton";

type AttendanceDatabase = IDBDatabase;

function hasIndexedDb() {
  return typeof window !== "undefined" && "indexedDB" in window;
}

function openAttendanceDb(): Promise<AttendanceDatabase | null> {
  if (!hasIndexedDb()) return Promise.resolve(null);

  return new Promise((resolve, reject) => {
    const request = window.indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(QUEUE_STORE)) {
        db.createObjectStore(QUEUE_STORE);
      }
      if (!db.objectStoreNames.contains(HISTORY_STORE)) {
        db.createObjectStore(HISTORY_STORE);
      }
    };

    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function readSingleton<T>(db: AttendanceDatabase, storeName: string): Promise<T> {
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(storeName, "readonly");
    const store = transaction.objectStore(storeName);
    const request = store.get(SINGLETON_KEY);

    request.onsuccess = () => {
      resolve((request.result as T | undefined) ?? ([] as unknown as T));
    };
    request.onerror = () => reject(request.error);
  });
}

function writeSingleton<T>(
  db: AttendanceDatabase,
  storeName: string,
  value: T,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(storeName, "readwrite");
    const store = transaction.objectStore(storeName);
    store.put(value, SINGLETON_KEY);
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error);
  });
}

export async function loadQueuedAttendance(): Promise<QueuedAttendanceSubmission[]> {
  const db = await openAttendanceDb();
  if (!db) return [];
  return readSingleton<QueuedAttendanceSubmission[]>(db, QUEUE_STORE);
}

export async function saveQueuedAttendance(
  queue: QueuedAttendanceSubmission[],
): Promise<void> {
  const db = await openAttendanceDb();
  if (!db) return;
  await writeSingleton(db, QUEUE_STORE, queue);
}

export async function loadAttendanceHistory(): Promise<DeviceAttendanceHistoryItem[]> {
  const db = await openAttendanceDb();
  if (!db) return [];
  return readSingleton<DeviceAttendanceHistoryItem[]>(db, HISTORY_STORE);
}

export async function saveAttendanceHistory(
  history: DeviceAttendanceHistoryItem[],
): Promise<void> {
  const db = await openAttendanceDb();
  if (!db) return;
  await writeSingleton(db, HISTORY_STORE, history);
}
