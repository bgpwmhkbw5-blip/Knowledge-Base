const DB_NAME = "knowledgeDiscord";

const REQUEST =
    indexedDB.open(DB_NAME, 1);

REQUEST.onupgradeneeded = event => {

    const db = event.target.result;

    db.createObjectStore(
        "categories",
        {
            keyPath:"id",
            autoIncrement:true
        }
    );

    db.createObjectStore(
        "channels",
        {
            keyPath:"id",
            autoIncrement:true
        }
    );

    db.createObjectStore(
        "messages",
        {
            keyPath:"id",
            autoIncrement:true
        }
    );
};