import Observer from '@cocreate/observer';
import State from '@cocreate/state';

/**
 * Main initialization entry point for ARIA attributes.
 * Orchestrates the setup of interactive controls and navigation states.
 * @param {Element|Element[]|NodeList} [elements] - Optional specific elements to initialize.
 * If omitted, the script scans the document for controls, toggles, and custom checked controls.
 */
function init(elements) {
    // 1. Initialize aria-controls (Toggles, Popups, Tabs)
    let controlsElements = elements;
    if (!controlsElements) {
        controlsElements = document.querySelectorAll(interactiveSelector);
    }
    initElement(controlsElements);

    // A controlled element is the canonical source when it already has state.
    // This allows restored state (for example state.aria-hidden) to correct all
    // of its controllers during initialization.
    document.querySelectorAll("[id][aria-hidden]").forEach(syncControlledElement);

    // 2. Initialize aria-current (Navigation links)
    // Performed after controls to ensure global scan happens last
    setAriaCurrent();
}

/**
 * Initializes interactive elements by binding click events and handling
 * accessibility state changes (aria-expanded, aria-hidden, aria-selected).
 * @param {Element|Element[]|NodeList} elements - Elements to be initialized as ARIA controls.
 */
const interactiveSelector = '[aria-controls], [aria-pressed], [role="radio"], [role="checkbox"], [role="switch"], :is([role="row"][aria-selected]), :is([role="grid"][aria-multiselectable="true"] [role="row"] input[type="checkbox"])';
const addedInteractiveSelector = '[aria-controls], [aria-pressed], [role="radio"], [role="checkbox"], [role="switch"], [aria-selected], input[type="checkbox"]';
const initialized = new WeakSet();

function initElement(elements) {
    if (
        !Array.isArray(elements) &&
        !(elements instanceof NodeList) &&
        !(elements instanceof HTMLCollection)
    ) {
        elements = [elements];
    }

    if (elements.length === 0) return;

    for (let control of elements) {
        if (!control?.matches?.(interactiveSelector)) continue;
        if (initialized.has(control)) continue;
        initialized.add(control);

        control.addEventListener("click", event => {
            if (!isDisabled(control)) return;
            event.preventDefault();
            event.stopImmediatePropagation();
        }, true);
        control.addEventListener("keydown", handleSelectionKey);
        syncSelection(control);
        control.addEventListener("click", event => {
            const selection = getSelection(control, true);
            if (selection?.role === "row") return;
            if (selection?.native) {
                syncLinkedSelection(control, selection, control.checked);
                return;
            }
            if (!selection || selection.attribute === "aria-selected") return;
            const selected = selection.exclusive || control.getAttribute(selection.attribute) !== "true";
            selectItem(control, selection, selected);
            syncLinkedSelection(control, selection, selected);
        });
        if (!control.hasAttribute("aria-controls") || isSelectionControl(control)) continue;
        initEscapeKey(control);

        control.addEventListener("click", function (event) {
            if (isSelectionControl(this)) return;

            const controlledId = this.getAttribute("aria-controls");
            const controlledElement = document.getElementById(controlledId);

            if (!controlledElement) {
                console.warn(`ARIA Controls: No element found with ID "${controlledId}" controlled by`, this);
                return;
            }

            const closeOn = controlledElement.getAttribute("aria-close-on");
            const role = this.getAttribute("role");
            const ariaOpenAttr = this.getAttribute("aria-open");
            const ariaCloseAttr = this.getAttribute("aria-close");
            // Treat these attributes as boolean-like: presence and not equal to "false"
            const hasAriaOpen = ariaOpenAttr !== null && ariaOpenAttr !== "false";
            const hasAriaClose = ariaCloseAttr !== null && ariaCloseAttr !== "false";
            const hidden = controlledElement.getAttribute("aria-hidden");
            const expanded = hidden === null
                ? this.getAttribute("aria-expanded")
                : hidden === "true" ? "false" : "true";
            const controlsClass = this.getAttribute("aria-controls-class") || "show";
            const group = this.getAttribute("aria-controls-group");

            // Prevent interaction if state is already in target position
            if (hasAriaOpen && expanded === "true") return;
            if (hasAriaClose && expanded !== "true") return;

            if (role === "tab") {
                activateTab(this);
            } else {
                // Toggle Pattern: Standard expand/collapse
                if (expanded === "true") {
                    controlledElement.setAttribute("aria-hidden", "true");
                    if (controlsClass) controlledElement.classList.remove(controlsClass);
                    updateAllControls(controlledId, "false");
                    removePopupListener();
                } else {
                    controlledElement.setAttribute("aria-hidden", "false");
                    if (controlsClass) controlledElement.classList.add(controlsClass);

                    // Handle grouped controls (Accordions)
                    if (group) {
                        const groupedControls = document.querySelectorAll(`[aria-controls-group="${group}"][aria-expanded="true"]`);
                        for (let groupedControl of groupedControls) {
                            if (isSelectionControl(groupedControl)) continue;
                            const groupedId = groupedControl.getAttribute("aria-controls");
                            if (!groupedId || groupedId === controlledId) continue;
                            const groupedElement = document.getElementById(groupedId);
                            if (!groupedElement) continue;
                            const gClass = groupedControl.getAttribute("aria-controls-class") || "show";
                            groupedElement.setAttribute("aria-hidden", "true");
                            if (gClass) groupedElement.classList.remove(gClass);
                            updateAllControls(groupedId, "false");
                        }
                    }
                    updateAllControls(controlledId, "true");
                    if (closeOn !== "btn" && closeOn !== "button") {
                        addPopupListener();
                    }
                }
            }
        });
    }
}

/**
 * Synchronizes aria-expanded state across all elements controlling the same ID.
 * @param {string} controlledId - The ID of the target element.
 * @param {string} state - The target state ('true' or 'false').
 */
function updateAllControls(controlledId, state) {
    const allControls = getControls(controlledId);
    allControls.forEach((ctrl) => {
        if (isSelectionControl(ctrl)) return;
        if (ctrl.getAttribute("role") === "tab") {
            setSelectionState(ctrl, "aria-selected", state === "true", true);
        } else setAttributeIfChanged(ctrl, "aria-expanded", state);
    });
}

/**
 * Returns every controller referencing an ID. In addition to the common
 * single-ID form, tolerate whitespace- or comma-separated references.
 */
function getControls(controlledId) {
    return Array.from(document.querySelectorAll("[aria-controls]")).filter(control =>
        (control.getAttribute("aria-controls") || "")
            .split(/[\s,]+/)
            .filter(Boolean)
            .includes(controlledId)
    );
}

/**
 * Writes an attribute only when its normalized string value changes.
 * This keeps controller/controlled-element mutation synchronization finite.
 */
function setAttributeIfChanged(element, attribute, value) {
    const nextValue = String(value);
    if (element.getAttribute(attribute) === nextValue) return false;
    element.setAttribute(attribute, nextValue);
    return true;
}

// Pressed and checked controls reference their targets without owning visibility.
function isSelectionControl(control) {
    return control.matches('input[type="radio"], input[type="checkbox"]') ||
        control.hasAttribute("aria-pressed") || control.hasAttribute("aria-checked");
}

function isDisabled(control) {
    return control.matches(":disabled") || control.getAttribute("aria-disabled") === "true";
}

function getGroupItems(control, role, groupRole) {
    const group = control.closest(`[role="${groupRole}"]`);
    return group ? Array.from(group.querySelectorAll(`[role="${role}"]`))
        .filter(item => item.closest(`[role="${groupRole}"]`) === group &&
            !(role === "radio" && item.matches('input[type="radio"]'))) : [control];
}

function getTabs(control) {
    return getGroupItems(control, "tab", "tablist");
}

function getSelection(control, includeNative = false) {
    // Native inputs retain browser activation and keyboard behavior.
    if (control.matches('input[type="radio"], input[type="checkbox"]')) {
        return includeNative ? {
            attribute: "aria-checked", native: true, role: control.type,
            exclusive: control.type === "radio", groupRole: "radiogroup"
        } : null;
    }
    const role = control.getAttribute("role");
    if (role === "row" && control.hasAttribute("aria-selected") &&
        control.closest('[role="grid"][aria-multiselectable="true"]'))
        return { attribute: "aria-selected", role, groupRole: "grid" };
    if (role === "tab") return { attribute: "aria-selected", exclusive: true, groupRole: "tablist", role };
    if (role === "radio") return { attribute: "aria-checked", exclusive: true, groupRole: "radiogroup", role };
    if (role === "checkbox" || role === "switch") return { attribute: "aria-checked" };
    if (control.hasAttribute("aria-pressed")) return { attribute: "aria-pressed" };
    return null;
}

function setSelectionState(control, attribute, selected, roving = false) {
    if (control.matches('input[type="radio"], input[type="checkbox"]')) {
        control.checked = selected;
        return;
    }
    setAttributeIfChanged(control, attribute, selected ? "true" : "false");
    if (attribute !== "aria-selected") control.classList.toggle("active", selected);
    if (roving) setAttributeIfChanged(control, "tabindex", selected ? "0" : "-1");
}

function availableItems(items) {
    return items.filter(item => !isDisabled(item) &&
        !item.closest('[aria-hidden="true"], [hidden]:not([aria-hidden="false"]), [template], template'));
}

function setTabStop(items, entry) {
    for (const item of items) setAttributeIfChanged(item, "tabindex", item === entry ? "0" : "-1");
}

function updateRadioTabStops(control, selection) {
    const items = getGroupItems(control, selection.role, selection.groupRole);
    const available = availableItems(items);
    const entry = available.find(item => item.getAttribute(selection.attribute) === "true") || available[0];
    setTabStop(items, entry);
}

function selectItem(control, selection, selected) {
    const items = selection.exclusive
        ? getGroupItems(control, selection.role, selection.groupRole) : [control];
    for (const item of items) {
        setSelectionState(item, selection.attribute, selected && item === control, selection.exclusive);
    }
    if (selection.role === "radio") updateRadioTabStops(control, selection);
}

const gridAnchors = new WeakMap();
const gridInteractive = 'a,button,input,textarea,select,label,[contenteditable]:not([contenteditable="false"]),[role="button"],[role="checkbox"],[role="radio"],[role="switch"]';

function gridRows(row) {
    return availableItems(getGroupItems(row, "row", "grid"))
        .filter(item => item.hasAttribute("aria-selected") &&
            !item.closest('[hidden],[template],template'));
}

function syncGridTabStops(row) {
    const items = gridRows(row);
    if (!items.length) return;
    setTabStop(items, items.find(item => item.tabIndex === 0) || items[0]);
}

function focusGridRow(row, items) {
    setTabStop(items, row);
    row.focus({ preventScroll: true });
}

function selectGridRow(row, event) {
    const grid = row.closest('[role="grid"][aria-multiselectable="true"]');
    const items = gridRows(row);
    if (!grid || !items.includes(row)) return;
    if (event.target.closest(gridInteractive)) return;

    const anchor = gridAnchors.get(grid);
    if (event.shiftKey && items.includes(anchor)) {
        const start = items.indexOf(anchor);
        const end = items.indexOf(row);
        for (let index = 0; index < items.length; index++) {
            const inRange = index >= Math.min(start, end) && index <= Math.max(start, end);
            const selected = inRange || ((event.ctrlKey || event.metaKey) && items[index].getAttribute("aria-selected") === "true");
            setSelectionState(items[index], "aria-selected", selected);
        }
    } else {
        const toggle = event.ctrlKey || event.metaKey;
        const selected = row.getAttribute("aria-selected") !== "true";
        for (const item of items) {
            if (!toggle || item === row)
                setSelectionState(item, "aria-selected", item === row && (toggle ? selected : true));
        }
        gridAnchors.set(grid, row);
    }
    focusGridRow(row, items);
}

function selectGridCheckbox(checkbox, event) {
    const row = checkbox.closest('[role="row"]');
    const grid = row?.closest('[role="grid"][aria-multiselectable="true"]');
    if (!grid) return;
    const items = availableItems(Array.from(grid.querySelectorAll('[role="row"] input[type="checkbox"]')))
        .filter(item => item.name === checkbox.name &&
            item.closest('[role="grid"]') === grid &&
            !isDisabled(item.closest('[role="row"]')) &&
            !item.closest('[hidden],[template],template'));
    const anchor = gridAnchors.get(grid);
    if (!event.shiftKey || !items.includes(anchor) || !items.includes(checkbox)) {
        gridAnchors.set(grid, checkbox);
        return;
    }
    const start = items.indexOf(anchor);
    const end = items.indexOf(checkbox);
    for (const item of items.slice(Math.min(start, end), Math.max(start, end) + 1)) {
        if (item === checkbox || item.checked === checkbox.checked) continue;
        item.checked = checkbox.checked;
        item.dispatchEvent(new Event("input", { bubbles: true }));
        item.dispatchEvent(new Event("change", { bubbles: true }));
    }
}

// Rendered cards and table rows can arrive after the initial ARIA scan.
// Handle their clicks at the grid so selection does not depend on binding
// each new record before its first interaction.
document.addEventListener("click", event => {
    const checkbox = event.target.closest('input[type="checkbox"]');
    if (checkbox?.closest('[role="row"]')?.closest('[role="grid"][aria-multiselectable="true"]')) {
        selectGridCheckbox(checkbox, event);
        return;
    }

    const row = event.target.closest('[role="row"][aria-selected]');
    if (row) selectGridRow(row, event);
});

function handleGridRowKey(event, row) {
    if (event.target !== row) return;
    const items = gridRows(row);
    if (!items.includes(row)) return;
    const grid = row.closest('[role="grid"][aria-multiselectable="true"]');
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "a") {
        event.preventDefault();
        for (const item of items) setSelectionState(item, "aria-selected", true);
        gridAnchors.delete(grid);
        return;
    }
    if (event.key === "Escape") {
        event.preventDefault();
        for (const item of items) setSelectionState(item, "aria-selected", false);
        gridAnchors.delete(grid);
        return;
    }
    if (event.key === " " || event.key === "Spacebar") {
        event.preventDefault();
        selectGridRow(row, { target: row, shiftKey: event.shiftKey, ctrlKey: true, metaKey: event.metaKey });
        return;
    }
    const index = items.indexOf(row);
    let next;
    if (event.key === "Home") next = items[0];
    else if (event.key === "End") next = items.at(-1);
    else if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
        const rtl = getComputedStyle(grid).direction === "rtl";
        next = items[index + ((event.key === "ArrowRight") !== rtl ? 1 : -1)];
    } else if (event.key === "ArrowUp" || event.key === "ArrowDown") {
        const box = row.getBoundingClientRect();
        const direction = event.key === "ArrowDown" ? 1 : -1;
        next = items.map(item => ({ item, box: item.getBoundingClientRect() }))
            .filter(candidate => (candidate.box.top - box.top) * direction > 1)
            .sort((a, b) => Math.abs(a.box.top - box.top) - Math.abs(b.box.top - box.top) ||
                Math.abs(a.box.left - box.left) - Math.abs(b.box.left - box.left))[0]?.item;
    } else return;
    event.preventDefault();
    if (!next) return;
    if (event.shiftKey) {
        if (!items.includes(gridAnchors.get(grid))) gridAnchors.set(grid, row);
        selectGridRow(next, { target: next, shiftKey: true, ctrlKey: event.ctrlKey, metaKey: event.metaKey });
    } else focusGridRow(next, items);
    next.scrollIntoView({ block: "nearest", inline: "nearest" });
}

document.addEventListener("mousedown", event => {
    if (event.shiftKey && event.target.closest('[role="grid"][aria-multiselectable="true"]') &&
        !event.target.closest(gridInteractive)) event.preventDefault();
});

function syncLinkedSelection(control, selection, selected) {
    const ids = (control.getAttribute("aria-controls") || "").split(/[\s,]+/).filter(Boolean);
    if (!ids.length) return;
    const controls = new Set(ids.flatMap(getControls));
    const radios = [];
    const nativeChanges = [];
    let hasSelectedToggle = false;
    for (const item of controls) {
        const peer = getSelection(item, true);
        if (!peer || peer.attribute === "aria-selected") continue;
        if (peer.role === "radio") radios.push({ item, selection: peer });
        if (item !== control && selected && (selection.role === "radio" || peer.role === "radio")) {
            if (peer.native && item.checked) nativeChanges.push(item);
            setSelectionState(item, peer.attribute, false);
            if (!peer.native && peer.role === "radio") updateRadioTabStops(item, peer);
        }
        if (peer.role !== "radio" && (peer.native ? item.checked : item.getAttribute(peer.attribute) !== "false")) {
            hasSelectedToggle = true;
        }
    }
    // "next" follows the next selected radio, never an independent toggle.
    if (selected && selection.role === "radio") {
        const movingDefaults = radios.filter(({ item }) => item.getAttribute("aria-default") === "next");
        if (movingDefaults.length) {
            for (const { item } of movingDefaults) {
                if (item !== control) item.removeAttribute("aria-default");
            }
            setAttributeIfChanged(control, "aria-default", "next");
        }
    }
    // Only an explicitly declared default restores selection after the last toggle.
    if (!selected && !hasSelectedToggle) {
        const defaults = radios.filter(({ item }) => item.hasAttribute("aria-default") &&
            item.getAttribute("aria-default") !== "false" && !isDisabled(item));
        if (defaults.length === 1) {
            const { item, selection: fallback } = defaults[0];
            if (fallback.native) {
                if (!item.checked) nativeChanges.push(item);
                setSelectionState(item, fallback.attribute, true);
            } else selectItem(item, fallback, true);
        }
    }
    // Notify value consumers after all linked inputs have their final state.
    for (const item of nativeChanges) {
        if (item.type === "radio" && !item.checked) continue;
        item.dispatchEvent(new Event("input", { bubbles: true }));
        item.dispatchEvent(new Event("change", { bubbles: true }));
    }
}

function syncSelection(control) {
    const selection = getSelection(control);
    if (selection?.role === "row") {
        syncGridTabStops(control);
        return;
    }
    if (!selection || selection.attribute === "aria-selected") return;
    const value = control.getAttribute(selection.attribute);
    if (selection.exclusive && value === "true") {
        selectItem(control, selection, true);
    } else {
        // Preserve mixed states until the user explicitly activates the control.
        if (value === null) setAttributeIfChanged(control, selection.attribute, "false");
        control.classList.toggle("active", value === "true");
        if (selection.exclusive) updateRadioTabStops(control, selection);
    }
    if (!selection.exclusive && !control.hasAttribute("tabindex") &&
        !control.matches('button, input, a[href]')) setAttributeIfChanged(control, "tabindex", "0");
}

function activateTab(control) {
    const targetId = control.getAttribute("aria-controls");
    if (!document.getElementById(targetId)) return;
    for (const tab of getTabs(control)) {
        const id = tab.getAttribute("aria-controls");
        const panel = document.getElementById(id);
        if (!panel) continue;
        const selected = id === targetId;
        setSelectionState(tab, "aria-selected", selected, true);
        setAttributeIfChanged(panel, "aria-hidden", selected ? "false" : "true");
        panel.classList.toggle(tab.getAttribute("aria-controls-class") || "show", selected);
        updateAllControls(id, selected ? "true" : "false");
        syncControlledElementState(panel);
    }
}

function handleSelectionKey(event) {
    const control = event.currentTarget;
    const selection = getSelection(control);
    if (!selection) return;
    if (isDisabled(control)) {
        if (["Enter", " ", "ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(event.key)) {
            event.preventDefault();
            event.stopImmediatePropagation();
        }
        return;
    }
    if (selection.role === "row") {
        handleGridRowKey(event, control);
        return;
    }
    let items = selection.exclusive
        ? availableItems(getGroupItems(control, selection.role, selection.groupRole)) : [control];
    if (selection.role === "tab") items = items.filter(item => document.getElementById(item.getAttribute("aria-controls")));
    const index = items.indexOf(control);
    if (index < 0) return;
    const vertical = control.closest(`[role="${selection.groupRole}"]`)?.getAttribute("aria-orientation") === "vertical";
    let destination;
    if (event.key === "Enter" || event.key === " ") destination = index;
    else if (selection.exclusive) {
        const nextKeys = selection.role === "radio" ? ["ArrowRight", "ArrowDown"] : [vertical ? "ArrowDown" : "ArrowRight"];
        const previousKeys = selection.role === "radio" ? ["ArrowLeft", "ArrowUp"] : [vertical ? "ArrowUp" : "ArrowLeft"];
        if (nextKeys.includes(event.key)) destination = (index + 1) % items.length;
        else if (previousKeys.includes(event.key)) destination = (index - 1 + items.length) % items.length;
        else if (event.key === "Home") destination = 0;
        else if (event.key === "End") destination = items.length - 1;
    }
    if (destination === undefined) return;
    event.preventDefault();
    if (event.repeat && !selection.exclusive) return;
    items[destination].focus();
    const toolbarNavigation = selection.role === "radio" && control.closest('[role="toolbar"]') &&
        event.key !== " " && event.key !== "Enter";
    if (toolbarNavigation) {
        for (const item of items) setAttributeIfChanged(item, "tabindex", item === items[destination] ? "0" : "-1");
    } else items[destination].click();
}

/**
 * Applies a controller's aria-expanded value to its controlled element and
 * synchronizes any other controllers that reference the same element.
 */
function syncController(control) {
    const controlledId = control?.getAttribute?.("aria-controls");
    if (!controlledId || isSelectionControl(control)) return;

    const controlledElement = document.getElementById(controlledId);
    if (!controlledElement) return;

    const isTab = control.getAttribute("role") === "tab";
    const expanded = control.getAttribute(isTab ? "aria-selected" : "aria-expanded") === "true";
    if (isTab && expanded) {
        activateTab(control);
        return;
    }
    const controlsClass = control.getAttribute("aria-controls-class") || "show";

    setAttributeIfChanged(controlledElement, "aria-hidden", expanded ? "false" : "true");
    if (controlsClass) controlledElement.classList.toggle(controlsClass, expanded);
    updateAllControls(controlledId, expanded ? "true" : "false");

    if (expanded) {
        const group = control.getAttribute("aria-controls-group");
        if (group) {
            const groupedControls = document.querySelectorAll(
                `[aria-controls-group="${group}"][aria-expanded="true"]`
            );
            for (const groupedControl of groupedControls) {
                if (isSelectionControl(groupedControl)) continue;
                const groupedId = groupedControl.getAttribute("aria-controls");
                if (!groupedId || groupedId === controlledId) continue;
                updateAllControls(groupedId, "false");
                syncController(groupedControl);
            }
        }

        const closeOn = controlledElement.getAttribute("aria-close-on");
        if ((control.hasAttribute("aria-haspopup") || closeOn) && closeOn !== "btn" && closeOn !== "button") {
            addPopupListener();
        }
    }
}

/**
 * Treats aria-hidden on the controlled element as canonical and uses the first
 * controller to fan that state out to every controller for the same ID.
 */
function syncControlledElement(controlledElement) {
    const controlledId = controlledElement?.id;
    if (!controlledId || !controlledElement.hasAttribute("aria-hidden")) return;

    const expanded = controlledElement.getAttribute("aria-hidden") !== "true";
    const expandedValue = expanded ? "true" : "false";
    const controls = getControls(controlledId).filter(control => !isSelectionControl(control));
    if (!controls.length) return;

    // The controlled element is canonical in this direction. Update every
    // controller directly rather than depending on one controller to fan out.
    updateAllControls(controlledId, expandedValue);
    if (expanded) {
        for (const control of controls) {
            if (control.getAttribute("role") === "tab") activateTab(control);
        }
    }

    const controlsClass = controls[0].getAttribute("aria-controls-class") || "show";
    if (controlsClass) controlledElement.classList.toggle(controlsClass, expanded);
}

/**
 * Initializes a newly added controller from its controlled element when that
 * element already has aria-hidden state. Initialization never writes state
 * from a controller to a controlled element.
 */
function syncAddedController(control) {
    const controlledId = control?.getAttribute?.("aria-controls");
    if (!controlledId || isSelectionControl(control)) return;

    const controlledElement = document.getElementById(controlledId);
    if (!controlledElement) return;

    if (controlledElement.hasAttribute("aria-hidden")) {
        syncControlledElement(controlledElement);
    }
}

/**
 * Persists a controlled element's ARIA state when it explicitly opts into
 * state persistence with state-id and state.aria-hidden.
 */
const pendingStateElements = new Set();
let stateTimer;
function syncControlledElementState(controlledElement) {
    if (!controlledElement?.hasAttribute?.("state.aria-hidden") ||
        !controlledElement.hasAttribute("state-id")) return;
    pendingStateElements.add(controlledElement);
    clearTimeout(stateTimer);
    // Let all panel/controller mutations settle before recording a tab switch.
    stateTimer = setTimeout(() => {
        const groups = { session: {}, local: {} };
        for (const element of pendingStateElements) {
            if (!element.isConnected) continue;
            // A tab can be hidden before its replacement is opened (including
            // direct attribute edits). Do not save that intermediate, empty
            // selection as a destination for browser Back/Forward.
            const tabControls = getControls(element.id).filter(control =>
                control.getAttribute("role") === "tab" && control.closest('[role="tablist"]')
            );
            if (tabControls.some(control => !getTabs(control).some(tab => {
                const panel = document.getElementById(tab.getAttribute("aria-controls"));
                return panel && panel.getAttribute("aria-hidden") !== "true";
            }))) continue;
            const value = element.getAttribute("aria-hidden");
            if (value === null) continue;
            const group = element.hasAttribute("state-localstorage") ||
                element.hasAttribute("state-onstoragechange") ? groups.local : groups.session;
            for (const id of element.getAttribute("state-id").split(',').map(id => id.trim()).filter(Boolean)) {
                group[id] = { "aria-hidden": value };
            }
        }
        pendingStateElements.clear();
        for (const [storage, state] of Object.entries(groups)) {
            if (!Object.keys(state).length) continue;
            let snapshot = {};
            try { snapshot = JSON.parse(window.history.state?.[`${storage}State`] || '{}'); } catch {}
            // State restoration already owns this history entry. Do not push
            // it again when ARIA observes the restored attributes.
            if (Object.entries(state).every(([id, value]) => snapshot?.[id]?.["aria-hidden"] === value["aria-hidden"])) continue;
            State.setState(state, { localStorage: storage === "local" });
        }
    }, 0);
}

/**
 * Binds a global click listener to handle "click-outside" behavior for popups.
 * Conditions are defined via 'aria-close-on' attribute (outside, inside, anywhere).
 */
let popupListener = null;

function getOpenPopupControls() {
    return Array.from(document.querySelectorAll('[aria-controls][aria-expanded="true"]')).filter(control =>
        !isSelectionControl(control) && (control.hasAttribute("aria-haspopup") ||
        document.getElementById(control.getAttribute("aria-controls"))?.hasAttribute("aria-close-on"))
    );
}

function isInteractionInside(element, target) {
    if (element.contains(target)) return true;

    // Activating <label for="…"> dispatches a second native click on its
    // associated control. The control may live outside a visual popup even
    // though the label that initiated the interaction is inside it.
    return Array.from(target?.labels || []).some(label =>
        element.contains(label)
    );
}

function addPopupListener() {
    if (!popupListener) {
        popupListener = function (event) {
            const hasPopUps = getOpenPopupControls();

            let skipControlledId = null;
            for (let hasPopUp of hasPopUps) {
                const controlledId = hasPopUp.getAttribute("aria-controls");
                if (skipControlledId === controlledId) continue;
                // Any control for this target counts as its trigger, regardless
                // of controller order or whether it declares aria-haspopup.
                if (getControls(controlledId).some(control => !isSelectionControl(control) && control.contains(event.target))) {
                    skipControlledId = controlledId;
                    continue;
                }

                const controlledElement = document.getElementById(controlledId);
                if (!controlledElement) continue;

                // Check if the click occurred on an item explicitly marked to exclude closing
                const excludeElement = event.target.closest('[aria-close="false"]');
                if (excludeElement && controlledElement.contains(excludeElement)) {
                    skipControlledId = controlledId;
                    continue;
                }

                let closeOn = controlledElement.getAttribute("aria-close-on");
                let closeOnEl = controlledElement;
                if (!closeOn) {
                    closeOnEl = event.target.closest(`#${controlledId} [aria-close-on]`);
                    if (closeOnEl) closeOn = closeOnEl.getAttribute("aria-close-on");
                }

                // A popup trigger can provide aria-haspopup for accessibility
                // without opting into automatic click-based closing.
                if (!closeOn || !closeOnEl) continue;

                let closeOnConditions = closeOn.split(",").map(c => c.trim());
                let shouldClose = false;
                const interactionInside = isInteractionInside(closeOnEl, event.target);

                for (let condition of closeOnConditions) {
                    if (condition === "outside" && !interactionInside) {
                        shouldClose = true;
                    } else if (condition === "inside" && interactionInside) {
                        shouldClose = true;
                    } else if (condition === "anywhere") {
                        shouldClose = true;
                    }
                    if (shouldClose) break;
                }

                if (!shouldClose) continue;

                controlledElement.classList.remove("show");
                controlledElement.setAttribute("aria-hidden", "true");
                updateAllControls(controlledId, "false");
            }

            if (!getOpenPopupControls().length) {
                document.removeEventListener("click", popupListener, true);
                popupListener = null;
            }
        };
        document.addEventListener("click", popupListener, true);
    }
}

/**
 * Removes the global popup click listener.
 */
function removePopupListener() {
    if (popupListener) {
        document.removeEventListener("click", popupListener, true);
        popupListener = null;
    }
}

/**
 * Binds the Escape key to close the controlled element.
 * @param {Element} control - The trigger element that controls the target.
 */
function initEscapeKey(control) {
    const controlledId = control.getAttribute("aria-controls");
    const controlledElement = document.getElementById(controlledId);
    if (controlledElement) {
        control.addEventListener("keydown", handleEscapeKey);
        controlledElement.addEventListener("keydown", handleEscapeKey);
    }
}

/**
 * Global handler for the Escape key to close open interactive elements.
 * @param {KeyboardEvent} event - The keyboard event object.
 */
function handleEscapeKey(event) {
    if (event.key === "Escape") {
        const toggleButton = event.currentTarget.matches?.("[aria-controls]")
            ? event.currentTarget
            : getControls(event.currentTarget.id).find(control => !isSelectionControl(control));

        if (toggleButton && !isSelectionControl(toggleButton)) {
            toggleButton.click();
        }
    }
}

/**
 * Manages navigation state attributes by scanning links and matching them against
 * the current URL and hash. Assigns aria-current="page" or "location".
 * @param {Element|Element[]|NodeList} [elements] - Links or containers to scan.
 * Defaults to all a[href] if not provided.
 */
function setAriaCurrent(elements) {
    if (!elements) {
        elements = document.querySelectorAll("a[href]");
    }

    if (
        !Array.isArray(elements) &&
        !(elements instanceof NodeList) &&
        !(elements instanceof HTMLCollection)
    ) {
        elements = [elements];
    }

    const currentUrl = new URL(window.location.href);
    const currentPage = `${currentUrl.origin}${normalizePath(currentUrl.pathname)}`;
    const currentHash = currentUrl.hash;

    for (const item of elements) {
        const links = (item.nodeName === 'A' && item.hasAttribute('href'))
            ? [item]
            : (item.querySelectorAll ? item.querySelectorAll("a[href]") : []);

        for (const link of links) {
            const href = link.getAttribute("href") || "";

            if (!href || href === "#") {
                link.removeAttribute("aria-current");
                continue;
            }

            let linkUrl;
            try {
                linkUrl = new URL(href, window.location.href);
            } catch {
                continue;
            }

            const linkPage = `${linkUrl.origin}${normalizePath(linkUrl.pathname)}`;
            const isSamePage = linkPage === currentPage;
            const linkHasHash = Boolean(linkUrl.hash);

            let ariaValue = null;

            if (isSamePage) {
                // Match exact location (hash) or general page
                if (linkHasHash && linkUrl.hash === currentHash) {
                    ariaValue = "location";
                } else if (!linkHasHash) {
                    ariaValue = "page";
                }
            }

            if (ariaValue) {
                link.setAttribute("aria-current", ariaValue);
            } else {
                link.removeAttribute("aria-current");
            }
        }
    }
}

/**
 * Sanitizes and normalizes URL paths to prevent trailing slash mismatches.
 * @param {string} path - The raw URL path.
 * @returns {string} The normalized path string.
 */
const normalizePath = (path) => path.replace(/\/$/, "") || "/";

/**
 * Event Listeners and Observers
 * Handles browser navigation events and dynamic DOM mutations.
 */
window.addEventListener("hashchange", () => setAriaCurrent());
window.addEventListener("popstate", () => setAriaCurrent());
document.addEventListener("keydown", handleEscapeKey);

// Observer: Interactive controls
Observer.init({
    name: "aria-controls",
    types: ["addedNodes"],
    selector: addedInteractiveSelector,
    callback: function (mutation) {
        initElement(mutation.target);
        syncAddedController(mutation.target);
    }
});

Observer.init({
    name: "aria-grid-row-removed",
    types: ["removedNodes"],
    selector: ':is([role="row"][aria-selected])',
    callback: function (mutation) {
        const grid = mutation.mutationOrigin.closest('[role="grid"][aria-multiselectable="true"]');
        const row = grid?.querySelector('[role="row"][aria-selected]');
        if (row) syncGridTabStops(row);
    }
});

// Selection changes from state restoration or other modules use the same logic.
Observer.init({
    name: "aria-selection-state",
    types: ["attributes"],
    selector: interactiveSelector,
    attributeFilter: ["aria-pressed", "aria-checked", "aria-selected", "aria-disabled", "disabled", "role"],
    callback: function (mutation) {
        if (mutation.oldValue === mutation.target.getAttribute(mutation.attributeName)) return;
        initElement(mutation.target);
        // Selection changes do not alter the grid's roving tab stop.
        if (mutation.attributeName === "aria-selected" && mutation.target.getAttribute("role") === "row") return;
        syncSelection(mutation.target);
    }
});

// A disclosure may reveal or hide radios within a larger group.
Observer.init({
    name: "aria-selection-visibility",
    types: ["attributes"],
    selector: "*",
    attributeFilter: ["aria-hidden", "hidden"],
    callback: function (mutation) {
        for (const radio of mutation.target.querySelectorAll('[role="radio"]')) {
            const selection = getSelection(radio);
            if (selection) updateRadioTabStops(radio, selection);
        }
        const grids = new Set(mutation.target.querySelectorAll('[role="grid"][aria-multiselectable="true"]'));
        const grid = mutation.target.closest('[role="grid"][aria-multiselectable="true"]');
        if (grid) grids.add(grid);
        for (const item of grids) {
            const row = item.querySelector('[role="row"][aria-selected]');
            if (row) syncGridTabStops(row);
        }
    }
});

// Observer: Apply externally changed controller state to its controlled element.
Observer.init({
    name: "aria-controller-state",
    types: ["attributes"],
    selector: "[aria-controls]",
    attributeFilter: ["aria-expanded", "aria-selected"],
    callback: function (mutation) {
        const element = mutation.target;
        const currentValue = element.getAttribute(mutation.attributeName);
        if (mutation.oldValue === currentValue) return;
        const isTab = element.getAttribute("role") === "tab";
        if (mutation.attributeName !== (isTab ? "aria-selected" : "aria-expanded")) return;
        syncController(element);
    }
});

// Observer: Treat externally changed controlled-element state as canonical and
// synchronize every controller that references it.
Observer.init({
    name: "aria-controlled-state",
    types: ["addedNodes", "attributes"],
    selector: "[aria-hidden]",
    attributeFilter: ["aria-hidden"],
    callback: function (mutation) {
        const element = mutation.target;
        if (!element.id) return;

        if (mutation.type === "attributes") {
            const currentValue = element.getAttribute(mutation.attributeName);
            if (mutation.oldValue === currentValue) return;
        }

        syncControlledElement(element);
        if (mutation.type === "attributes") syncControlledElementState(element);
    }
});

// Observer: Navigation links
Observer.init({
    name: "aria-current",
    types: ["addedNodes", "attributes"],
    selector: "a[href]",
    attributeFilters: ["href"],
    callback: function (mutation) {
        setAriaCurrent(mutation.target);
    }
});

// Initial execution
init();

export {
    init,
    initElement,
    setAriaCurrent,
    syncController,
    syncAddedController,
    syncControlledElement,
    syncControlledElementState,
    getControls
};
