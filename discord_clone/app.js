const DEFAULT_STRUCTURE = {
    servers: [
        {
            id: "main",
            name: "Main",
            categories: [
                {
                    id: "main:general",
                    name: "General",
                    collapsed: false,
                    channels: [
                        { id: "ideas", name: "ideas" },
                        { id: "lectures", name: "lectures" }
                    ]
                }
            ]
        }
    ],
    settings: {
        randomMin: 1,
        randomMax: 100
    }
};

const state = {
    ready: false,
    structure: structuredClone(DEFAULT_STRUCTURE),
    activeServerId: "main",
    activeChannelId: "ideas",
    messagesByChannel: new Map(),
    search: "",
    draftAttachments: [],
    storageText: "Storage: checking",
    randomNumberText: "",
    error: ""
};

const els = {
    servers: document.getElementById("servers"),
    channels: document.getElementById("channels"),
    activeTitle: document.getElementById("activeTitle"),
    activeMeta: document.getElementById("activeMeta"),
    messages: document.getElementById("messages"),
    noteInput: document.getElementById("noteInput"),
    sendBtn: document.getElementById("sendBtn"),
    newChannelBtn: document.getElementById("newChannelBtn"),
    newServerBtn: document.getElementById("newServerBtn"),
    newCategoryBtn: document.getElementById("newCategoryBtn"),
    deleteChannelBtn: document.getElementById("deleteChannelBtn"),
    randomChannelBtn: document.getElementById("randomChannelBtn"),
    randomMessageBtn: document.getElementById("randomMessageBtn"),
    imageInput: document.getElementById("imageInput"),
    attachImageBtn: document.getElementById("attachImageBtn"),
    attachmentPreview: document.getElementById("attachmentPreview"),
    searchInput: document.getElementById("searchInput"),
    randomMin: document.getElementById("randomMin"),
    randomMax: document.getElementById("randomMax"),
    randomNumberBtn: document.getElementById("randomNumberBtn"),
    randomNumberResult: document.getElementById("randomNumberResult"),
    storageInfo: document.getElementById("storageInfo")
};

document.addEventListener("DOMContentLoaded", initApp);

async function initApp() {
    bindEvents();
    render();

    try {
        await initDB();
        const savedStructure = await loadStructure();

        state.structure = normalizeStructure(savedStructure);
        selectInitialChannel();
        hydrateSettingsControls();

        await loadActiveChannelMessages();
        state.ready = true;
        refreshStorageEstimate();
    } catch (error) {
        state.error = "Storage could not be loaded. Notes may not persist until this is fixed.";
        console.error(error);
    }

    render();
    registerServiceWorker();
}

function bindEvents() {
    els.sendBtn.addEventListener("click", sendMessage);

    els.noteInput.addEventListener("keydown", (event) => {
        if (event.key === "Enter" && !event.shiftKey) {
            event.preventDefault();
            sendMessage();
        }
    });

    els.noteInput.addEventListener("paste", handlePaste);
    els.attachImageBtn.addEventListener("click", () => els.imageInput.click());
    els.imageInput.addEventListener("change", () => addImageFiles([...els.imageInput.files]));

    els.newServerBtn.addEventListener("click", createServer);
    els.newCategoryBtn.addEventListener("click", createCategory);
    els.newChannelBtn.addEventListener("click", createChannel);
    els.deleteChannelBtn.addEventListener("click", deleteActiveChannel);
    els.randomChannelBtn.addEventListener("click", selectRandomChannel);
    els.randomMessageBtn.addEventListener("click", selectRandomMessageInActiveChannel);

    els.searchInput.addEventListener("input", () => {
        state.search = els.searchInput.value.trim().toLowerCase();
        renderMessages();
    });

    els.randomMin.addEventListener("change", saveRandomRange);
    els.randomMax.addEventListener("change", saveRandomRange);
    els.randomNumberBtn.addEventListener("click", selectRandomNumber);
}

function normalizeStructure(savedStructure) {
    const base = savedStructure || structuredClone(DEFAULT_STRUCTURE);

    if (!base.servers && !Array.isArray(base)) {
        const servers = Object.entries(base).map(([serverName, channels]) => ({
            id: slugify(serverName),
            name: serverName,
            channels: (channels || []).map((channelName) => ({
                id: channelKey(slugify(serverName), channelName),
                name: channelName
            }))
        }));

        return normalizeStructure({ servers });
    }

    const servers = (base.servers || [])
        .map((server, serverIndex) => normalizeServer(server, serverIndex))
        .filter((server) => server.name);

    const structure = {
        servers: servers.length ? servers : structuredClone(DEFAULT_STRUCTURE.servers),
        settings: {
            ...DEFAULT_STRUCTURE.settings,
            ...(base.settings || {})
        }
    };

    if (structure.servers.every((server) => allChannels(server).length === 0)) {
        structure.servers[0].categories[0].channels.push({
            id: channelKey(structure.servers[0].id, "general"),
            name: "general"
        });
    }

    return structure;
}

function normalizeServer(server, serverIndex) {
    const serverId = server.id || slugify(server.name || `server-${serverIndex + 1}`);
    const legacyChannels = server.channels || [];
    const rawCategories = server.categories?.length
        ? server.categories
        : [{ id: `${serverId}:general`, name: "General", collapsed: false, channels: legacyChannels }];

    return {
        id: serverId,
        name: server.name || "Untitled",
        categories: rawCategories.map((category, categoryIndex) => ({
            id: category.id || `${serverId}:${slugify(category.name || `category-${categoryIndex + 1}`)}`,
            name: category.name || "General",
            collapsed: Boolean(category.collapsed),
            channels: (category.channels || []).map((channel, channelIndex) => {
                const name = typeof channel === "string"
                    ? channel
                    : channel.name || `channel-${channelIndex + 1}`;

                return {
                    id: typeof channel === "string"
                        ? channelKey(serverId, name)
                        : channel.id || channelKey(serverId, name),
                    name
                };
            })
        }))
    };
}

function selectInitialChannel() {
    const server = getActiveServer() || state.structure.servers[0];
    state.activeServerId = server.id;

    const channel = allChannels(server).find((item) => item.id === state.activeChannelId) || allChannels(server)[0];
    state.activeChannelId = channel?.id || null;
}

async function loadActiveChannelMessages() {
    if (!state.activeChannelId) return;

    const rawMessages = await getChannelMessages(state.activeChannelId);
    state.messagesByChannel.set(state.activeChannelId, normalizeMessages(rawMessages));
}

function normalizeMessages(messages) {
    return (messages || []).map((message) => {
        if (typeof message === "string") {
            return createMessage(message, []);
        }

        return {
            id: message.id || crypto.randomUUID(),
            text: message.text || "",
            createdAt: message.createdAt || new Date().toISOString(),
            pinned: Boolean(message.pinned),
            tags: Array.isArray(message.tags) ? message.tags : extractTags(message.text || ""),
            attachments: Array.isArray(message.attachments) ? message.attachments : []
        };
    });
}

function getActiveServer() {
    return state.structure.servers.find((server) => server.id === state.activeServerId);
}

function getActiveCategory() {
    const server = getActiveServer();
    return server?.categories.find((category) => (
        category.channels.some((channel) => channel.id === state.activeChannelId)
    ));
}

function getActiveChannel() {
    return getActiveCategory()?.channels.find((channel) => channel.id === state.activeChannelId);
}

function getActiveMessages() {
    return state.messagesByChannel.get(state.activeChannelId) || [];
}

function allChannels(server = getActiveServer()) {
    return server?.categories.flatMap((category) => category.channels) || [];
}

function render() {
    renderServers();
    renderChannels();
    renderHeader();
    renderMessages();
    renderComposer();
    renderUtilityPanel();
}

function renderServers() {
    els.servers.innerHTML = "";

    state.structure.servers.forEach((server) => {
        const button = document.createElement("button");
        button.className = `server ${server.id === state.activeServerId ? "active" : ""}`;
        button.type = "button";
        button.textContent = initials(server.name);
        button.title = server.name;

        button.addEventListener("click", async () => {
            state.activeServerId = server.id;
            state.activeChannelId = allChannels(server)[0]?.id || null;
            await loadActiveChannelMessages();
            render();
        });

        els.servers.appendChild(button);
    });
}

function renderChannels() {
    els.channels.innerHTML = "";
    const server = getActiveServer();

    if (!server || allChannels(server).length === 0) {
        els.channels.appendChild(emptyPanel("No channels yet"));
        return;
    }

    server.categories.forEach((category) => {
        const group = document.createElement("section");
        group.className = "category";

        const header = document.createElement("button");
        header.className = "categoryHeader";
        header.type = "button";
        header.innerHTML = `<span>${category.collapsed ? ">" : "v"}</span><strong>${escapeHTML(category.name)}</strong>`;
        header.addEventListener("click", async () => {
            category.collapsed = !category.collapsed;
            await saveStructure(state.structure);
            renderChannels();
        });

        group.appendChild(header);

        if (!category.collapsed) {
            category.channels.forEach((channel) => {
                group.appendChild(renderChannelRow(channel));
            });
        }

        els.channels.appendChild(group);
    });
}

function renderChannelRow(channel) {
    const row = document.createElement("div");
    row.className = `channelRow ${channel.id === state.activeChannelId ? "active" : ""}`;

    const select = document.createElement("button");
    select.className = "channel";
    select.type = "button";
    select.innerHTML = `<span class="hash">#</span><span>${escapeHTML(channel.name)}</span>`;
    select.addEventListener("click", async () => {
        if (channel.id === state.activeChannelId) return;

        state.activeChannelId = channel.id;
        await loadActiveChannelMessages();
        render();
    });

    const random = document.createElement("button");
    random.className = "channelTool";
    random.type = "button";
    random.textContent = "?";
    random.title = "Random note in this channel";
    random.addEventListener("click", async () => {
        await selectRandomMessage(channel.id);
    });

    const remove = document.createElement("button");
    remove.className = "channelTool danger";
    remove.type = "button";
    remove.textContent = "x";
    remove.title = "Delete channel";
    remove.addEventListener("click", () => deleteChannel(channel.id));

    row.append(select, random, remove);
    return row;
}

function renderHeader() {
    const channel = getActiveChannel();
    const category = getActiveCategory();
    const messages = getActiveMessages();
    const pinnedCount = messages.filter((message) => message.pinned).length;

    els.activeTitle.textContent = channel ? `# ${channel.name}` : "No channel selected";
    els.activeMeta.textContent = channel
        ? `${category?.name || "General"} · ${messages.length} notes · ${pinnedCount} pinned · local only`
        : "Create a channel to start";
}

function renderMessages() {
    els.messages.innerHTML = "";

    if (state.error) {
        els.messages.appendChild(emptyPanel(state.error));
        return;
    }

    if (!state.ready) {
        els.messages.appendChild(emptyPanel("Loading notes"));
        return;
    }

    const messages = getVisibleMessages();

    if (messages.length === 0) {
        els.messages.appendChild(emptyPanel(state.search ? "No matching notes" : "No notes yet"));
        return;
    }

    messages.forEach((message) => {
        els.messages.appendChild(renderMessage(message));
    });

    els.messages.scrollTop = els.messages.scrollHeight;
}

function renderMessage(message) {
    const article = document.createElement("article");
    article.className = `message ${message.pinned ? "pinned" : ""}`;
    article.dataset.messageId = message.id;

    const header = document.createElement("div");
    header.className = "messageHeader";

    const meta = document.createElement("div");
    meta.className = "messageMeta";
    meta.textContent = formatDate(message.createdAt);

    const actions = document.createElement("div");
    actions.className = "messageActions";

    const pinButton = document.createElement("button");
    pinButton.className = "iconButton";
    pinButton.type = "button";
    pinButton.textContent = message.pinned ? "Unpin" : "Pin";
    pinButton.addEventListener("click", () => togglePin(message.id));

    const deleteButton = document.createElement("button");
    deleteButton.className = "iconButton danger";
    deleteButton.type = "button";
    deleteButton.textContent = "Delete";
    deleteButton.addEventListener("click", () => deleteMessage(message.id));

    actions.append(pinButton, deleteButton);
    header.append(meta, actions);
    article.appendChild(header);

    if (message.text) {
        const text = document.createElement("p");
        text.className = "messageText";
        text.textContent = message.text;
        article.appendChild(text);
    }

    renderAttachments(message.attachments).forEach((attachment) => article.appendChild(attachment));

    const url = firstURL(message.text);
    const embed = createEmbed(url);
    if (url) {
        const link = document.createElement("a");
        link.className = "sourceLink";
        link.href = url;
        link.target = "_blank";
        link.rel = "noopener noreferrer";
        link.textContent = url;
        article.appendChild(link);
    }

    if (embed) {
        article.appendChild(embed);
    }

    if (message.tags.length > 0) {
        const tags = document.createElement("div");
        tags.className = "tags";

        message.tags.forEach((tag) => {
            const chip = document.createElement("button");
            chip.className = "tag";
            chip.type = "button";
            chip.textContent = `#${tag}`;
            chip.addEventListener("click", () => {
                els.searchInput.value = `#${tag}`;
                state.search = `#${tag}`;
                renderMessages();
            });
            tags.appendChild(chip);
        });

        article.appendChild(tags);
    }

    return article;
}

function renderAttachments(attachments) {
    return attachments.map((attachment) => {
        if (attachment.type?.startsWith("image/")) {
            const figure = document.createElement("figure");
            figure.className = "imageAttachment";

            const image = document.createElement("img");
            image.src = attachment.dataUrl;
            image.alt = attachment.name || "Pasted image";
            image.loading = "lazy";

            const caption = document.createElement("figcaption");
            caption.textContent = `${attachment.name || "Local image"} · ${formatBytes(attachment.size || 0)}`;

            figure.append(image, caption);
            return figure;
        }

        const fallback = document.createElement("div");
        fallback.className = "fileAttachment";
        fallback.textContent = attachment.name || "Local file";
        return fallback;
    });
}

function renderComposer() {
    const hasChannel = Boolean(state.activeChannelId);
    const enabled = state.ready && hasChannel;
    els.noteInput.disabled = !enabled;
    els.sendBtn.disabled = !enabled;
    els.attachImageBtn.disabled = !enabled;
    els.newChannelBtn.disabled = !state.ready;
    els.newCategoryBtn.disabled = !state.ready;
    els.deleteChannelBtn.disabled = !enabled;
    els.randomChannelBtn.disabled = !state.ready || allChannels().length === 0;
    els.randomMessageBtn.disabled = !enabled;

    els.attachmentPreview.innerHTML = "";
    state.draftAttachments.forEach((attachment) => {
        const chip = document.createElement("button");
        chip.className = "attachmentChip";
        chip.type = "button";
        chip.textContent = `${attachment.name || "image"} x`;
        chip.title = "Remove image";
        chip.addEventListener("click", () => {
            state.draftAttachments = state.draftAttachments.filter((item) => item.id !== attachment.id);
            renderComposer();
        });
        els.attachmentPreview.appendChild(chip);
    });
}

function renderUtilityPanel() {
    els.storageInfo.textContent = state.storageText;
    els.randomNumberResult.textContent = state.randomNumberText;
}

function getVisibleMessages() {
    const messages = getActiveMessages();
    const ordered = [...messages].sort((a, b) => {
        if (a.pinned !== b.pinned) return a.pinned ? -1 : 1;
        return new Date(a.createdAt) - new Date(b.createdAt);
    });

    if (!state.search) {
        return ordered;
    }

    return ordered.filter((message) => {
        const searchable = [
            message.text,
            message.tags.map((tag) => `#${tag}`).join(" "),
            message.attachments.map((attachment) => attachment.name).join(" ")
        ].join(" ").toLowerCase();
        return searchable.includes(state.search);
    });
}

async function sendMessage() {
    const text = els.noteInput.value.trim();

    if ((!text && state.draftAttachments.length === 0) || !state.activeChannelId || !state.ready) {
        return;
    }

    const messages = [...getActiveMessages(), createMessage(text, state.draftAttachments)];
    state.messagesByChannel.set(state.activeChannelId, messages);
    state.draftAttachments = [];
    els.noteInput.value = "";
    render();

    await saveChannelMessages(state.activeChannelId, messages);
    refreshStorageEstimate();
}

async function createServer() {
    const rawName = prompt("Workspace/server name?");
    const name = normalizeDisplayName(rawName);
    if (!name) return;

    const server = {
        id: uniqueId("server", name),
        name,
        categories: [
            {
                id: uniqueId("category", "general"),
                name: "General",
                collapsed: false,
                channels: [{ id: uniqueId("channel", "general"), name: "general" }]
            }
        ]
    };

    state.structure.servers.push(server);
    state.activeServerId = server.id;
    state.activeChannelId = server.categories[0].channels[0].id;
    state.messagesByChannel.set(state.activeChannelId, []);

    await saveStructure(state.structure);
    render();
}

async function createCategory() {
    const server = getActiveServer();
    if (!server) return;

    const rawName = prompt("Category/folder name?");
    const name = normalizeDisplayName(rawName);
    if (!name) return;

    server.categories.push({
        id: uniqueId("category", name),
        name,
        collapsed: false,
        channels: []
    });

    await saveStructure(state.structure);
    render();
}

async function createChannel() {
    const server = getActiveServer();
    if (!server) return;

    const rawName = prompt("Channel name?");
    const name = normalizeChannelName(rawName);

    if (!name) return;

    const existing = allChannels(server).find((channel) => channel.name.toLowerCase() === name.toLowerCase());
    if (existing) {
        state.activeChannelId = existing.id;
        await loadActiveChannelMessages();
        render();
        return;
    }

    const category = getActiveCategory() || server.categories[0];
    const channel = {
        id: uniqueId("channel", name),
        name
    };

    category.channels.push(channel);
    category.collapsed = false;
    state.activeChannelId = channel.id;
    state.messagesByChannel.set(channel.id, []);

    await saveStructure(state.structure);
    render();
}

async function deleteActiveChannel() {
    if (state.activeChannelId) {
        await deleteChannel(state.activeChannelId);
    }
}

async function deleteChannel(channelId) {
    const server = getActiveServer();
    if (!server) return;

    const channel = allChannels(server).find((item) => item.id === channelId);
    if (!channel) return;

    const confirmed = confirm(`Delete #${channel.name}? Notes in this channel will no longer appear.`);
    if (!confirmed) return;

    server.categories.forEach((category) => {
        category.channels = category.channels.filter((item) => item.id !== channelId);
    });

    state.messagesByChannel.delete(channelId);

    if (state.activeChannelId === channelId) {
        state.activeChannelId = allChannels(server)[0]?.id || null;
        await loadActiveChannelMessages();
    }

    await deleteChannelMessages(channelId);
    await saveStructure(state.structure);
    render();
    refreshStorageEstimate();
}

async function togglePin(messageId) {
    const messages = getActiveMessages().map((message) => (
        message.id === messageId
            ? { ...message, pinned: !message.pinned }
            : message
    ));

    state.messagesByChannel.set(state.activeChannelId, messages);
    renderMessages();
    renderHeader();

    await saveChannelMessages(state.activeChannelId, messages);
}

async function deleteMessage(messageId) {
    const confirmed = confirm("Delete this note?");
    if (!confirmed) return;

    const messages = getActiveMessages().filter((message) => message.id !== messageId);

    state.messagesByChannel.set(state.activeChannelId, messages);
    render();

    await saveChannelMessages(state.activeChannelId, messages);
    refreshStorageEstimate();
}

async function selectRandomChannel() {
    const channels = allChannels();
    const channel = randomItem(channels);
    if (!channel) return;

    state.activeChannelId = channel.id;
    await loadActiveChannelMessages();
    render();
}

async function selectRandomMessageInActiveChannel() {
    await selectRandomMessage(state.activeChannelId);
}

async function selectRandomMessage(channelId) {
    if (!channelId) return;

    if (channelId !== state.activeChannelId) {
        state.activeChannelId = channelId;
        await loadActiveChannelMessages();
    }

    const message = randomItem(getActiveMessages());
    render();

    if (!message) return;

    requestAnimationFrame(() => {
        const node = els.messages.querySelector(`[data-message-id="${message.id}"]`);
        node?.scrollIntoView({ behavior: "smooth", block: "center" });
        node?.classList.add("selected");
        setTimeout(() => node?.classList.remove("selected"), 1400);
    });
}

async function selectRandomNumber() {
    const range = getRandomRange();
    const min = Math.min(range.min, range.max);
    const max = Math.max(range.min, range.max);
    const value = Math.floor(Math.random() * (max - min + 1)) + min;

    state.randomNumberText = String(value);
    state.structure.settings.randomMin = min;
    state.structure.settings.randomMax = max;
    hydrateSettingsControls();
    renderUtilityPanel();

    await saveStructure(state.structure);
}

async function saveRandomRange() {
    const range = getRandomRange();
    state.structure.settings.randomMin = range.min;
    state.structure.settings.randomMax = range.max;
    await saveStructure(state.structure);
}

function getRandomRange() {
    return {
        min: Number.parseInt(els.randomMin.value, 10) || DEFAULT_STRUCTURE.settings.randomMin,
        max: Number.parseInt(els.randomMax.value, 10) || DEFAULT_STRUCTURE.settings.randomMax
    };
}

function hydrateSettingsControls() {
    els.randomMin.value = state.structure.settings.randomMin;
    els.randomMax.value = state.structure.settings.randomMax;
}

function createMessage(text, attachments) {
    return {
        id: crypto.randomUUID(),
        text,
        createdAt: new Date().toISOString(),
        pinned: false,
        tags: extractTags(text),
        attachments: structuredClone(attachments)
    };
}

async function handlePaste(event) {
    const files = [...event.clipboardData?.files || []].filter((file) => file.type.startsWith("image/"));
    if (files.length === 0) return;

    event.preventDefault();
    await addImageFiles(files);
}

async function addImageFiles(files) {
    const images = files.filter((file) => file.type.startsWith("image/"));
    const attachments = await Promise.all(images.map(fileToAttachment));

    state.draftAttachments.push(...attachments);
    els.imageInput.value = "";
    renderComposer();
}

function fileToAttachment(file) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve({
            id: crypto.randomUUID(),
            name: file.name || "pasted-image",
            type: file.type,
            size: file.size,
            dataUrl: reader.result
        });
        reader.onerror = () => reject(reader.error);
        reader.readAsDataURL(file);
    });
}

function createEmbed(url) {
    if (!url) return null;

    const youtubeId = getYouTubeId(url);
    if (youtubeId) {
        const iframe = document.createElement("iframe");
        iframe.className = "embed";
        iframe.src = `https://www.youtube.com/embed/${youtubeId}`;
        iframe.title = "Embedded YouTube video";
        iframe.allow = "accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture";
        iframe.allowFullscreen = true;
        return iframe;
    }

    if (/\.(mp4|webm|ogg)(\?.*)?$/i.test(url)) {
        const video = document.createElement("video");
        video.className = "embed";
        video.src = url;
        video.controls = true;
        return video;
    }

    return null;
}

function firstURL(text) {
    return text.match(/https?:\/\/[^\s]+/i)?.[0] || "";
}

function getYouTubeId(url) {
    try {
        const parsed = new URL(url);

        if (parsed.hostname.includes("youtu.be")) {
            return parsed.pathname.slice(1);
        }

        if (parsed.hostname.includes("youtube.com")) {
            return parsed.searchParams.get("v");
        }
    } catch {
        return "";
    }

    return "";
}

async function refreshStorageEstimate() {
    if (!navigator.storage?.estimate) {
        state.storageText = "Storage: browser estimate unavailable";
        renderUtilityPanel();
        return;
    }

    const estimate = await navigator.storage.estimate();
    const used = formatBytes(estimate.usage || 0);
    const quota = formatBytes(estimate.quota || 0);
    state.storageText = `Storage: ${used} used of ${quota} available on this device`;
    renderUtilityPanel();
}

function extractTags(text) {
    const tags = text.match(/#[a-z0-9_-]+/gi) || [];
    return [...new Set(tags.map((tag) => tag.slice(1).toLowerCase()))];
}

function normalizeChannelName(value) {
    return (value || "")
        .trim()
        .toLowerCase()
        .replace(/^#/, "")
        .replace(/[^a-z0-9_-]+/g, "-")
        .replace(/^-+|-+$/g, "");
}

function normalizeDisplayName(value) {
    return (value || "").trim().replace(/\s+/g, " ");
}

function channelKey(serverId, name) {
    return `${serverId}:${normalizeChannelName(name) || crypto.randomUUID()}`;
}

function slugify(value) {
    return normalizeChannelName(value) || crypto.randomUUID();
}

function uniqueId(prefix, name) {
    return `${prefix}:${slugify(name)}:${crypto.randomUUID().slice(0, 8)}`;
}

function initials(value) {
    return value
        .split(/\s+/)
        .filter(Boolean)
        .slice(0, 2)
        .map((part) => part[0].toUpperCase())
        .join("") || "K";
}

function randomItem(items) {
    if (!items.length) return null;
    return items[Math.floor(Math.random() * items.length)];
}

function formatDate(value) {
    return new Intl.DateTimeFormat(undefined, {
        month: "short",
        day: "numeric",
        hour: "numeric",
        minute: "2-digit"
    }).format(new Date(value));
}

function formatBytes(bytes) {
    if (!bytes) return "0 B";

    const units = ["B", "KB", "MB", "GB", "TB"];
    const index = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
    const value = bytes / 1024 ** index;
    return `${value.toFixed(value >= 10 || index === 0 ? 0 : 1)} ${units[index]}`;
}

function emptyPanel(text) {
    const panel = document.createElement("div");
    panel.className = "emptyPanel";
    panel.textContent = text;
    return panel;
}

function escapeHTML(value) {
    const span = document.createElement("span");
    span.textContent = value;
    return span.innerHTML;
}

function registerServiceWorker() {
    if ("serviceWorker" in navigator) {
        navigator.serviceWorker.register("sw.js").catch((error) => {
            console.warn("Service worker registration failed", error);
        });
    }
}
