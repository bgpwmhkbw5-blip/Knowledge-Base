const DB_NAME = "knowledgeDiscord";
const DB_VERSION = 2;
const STRUCTURE_ID = "main";

let db;

function requestToPromise(request) {
    return new Promise((resolve, reject) => {
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
    });
}

function transactionDone(tx) {
    return new Promise((resolve, reject) => {
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
        tx.onabort = () => reject(tx.error);
    });
}

function initDB() {
    return new Promise((resolve, reject) => {
        const request = indexedDB.open(DB_NAME, DB_VERSION);

        request.onupgradeneeded = (event) => {
            const nextDb = event.target.result;

            if (nextDb.objectStoreNames.contains("messages")) {
                const tx = event.target.transaction;
                const store = tx.objectStore("messages");

                if (store.keyPath !== "channel") {
                    nextDb.deleteObjectStore("messages");
                }
            }

            if (!nextDb.objectStoreNames.contains("messages")) {
                nextDb.createObjectStore("messages", { keyPath: "channel" });
            }

            if (!nextDb.objectStoreNames.contains("structure")) {
                nextDb.createObjectStore("structure", { keyPath: "id" });
            }
        };

        request.onsuccess = () => {
            db = request.result;
            resolve(db);
        };

        request.onerror = () => reject(request.error);
    });
}

function ensureDB() {
    if (!db) {
        throw new Error("Database has not been initialized.");
    }
}

async function loadStructure() {
    ensureDB();

    const tx = db.transaction("structure", "readonly");
    const store = tx.objectStore("structure");
    const record = await requestToPromise(store.get(STRUCTURE_ID));

    return record?.data || null;
}

async function saveStructure(data) {
    ensureDB();

    const tx = db.transaction("structure", "readwrite");
    const store = tx.objectStore("structure");

    store.put({
        id: STRUCTURE_ID,
        data: structuredClone(data)
    });

    await transactionDone(tx);
}

async function getChannelMessages(channelId) {
    ensureDB();

    const tx = db.transaction("messages", "readonly");
    const store = tx.objectStore("messages");
    const record = await requestToPromise(store.get(channelId));

    return record?.messages || [];
}

async function saveChannelMessages(channelId, messages) {
    ensureDB();

    const tx = db.transaction("messages", "readwrite");
    const store = tx.objectStore("messages");

    store.put({
        channel: channelId,
        messages: structuredClone(messages)
    });

    await transactionDone(tx);
}

async function deleteChannelMessages(channelId) {
    ensureDB();

    const tx = db.transaction("messages", "readwrite");
    const store = tx.objectStore("messages");

    store.delete(channelId);

    await transactionDone(tx);
}
