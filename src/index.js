import Observer from '@cocreate/observer';
import State from '@cocreate/state';

/**
 * Main initialization entry point for ARIA attributes.
 * Orchestrates the setup of interactive controls and navigation states.
 * @param {Element|Element[]|NodeList} [elements] - Optional specific elements to initialize. 
 * If omitted, the script scans the entire document for [aria-controls].
 */
function init(elements) {
    // 1. Initialize aria-controls (Toggles, Popups, Tabs)
    let controlsElements = elements;
    if (!controlsElements) {
        controlsElements = document.querySelectorAll("[aria-controls]");
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
const initialized = new Set();

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
        if (!control.hasAttribute('aria-controls')) continue;
        if (initialized.has(control)) continue;
        initialized.add(control);
        
        initEscapeKey(control);
        
        control.addEventListener("click", function (event) {
            // Only prevent default if it's not a standard link leading to another page
            const href = this.getAttribute("href");
            if (!href || href.startsWith("#") || this.hasAttribute("aria-haspopup")) {
                event.preventDefault();
            }

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
            const expanded = this.getAttribute("aria-expanded");
            const controlsClass = this.getAttribute("aria-controls-class") || "show";
            const group = this.getAttribute("aria-controls-group");

            // Prevent interaction if state is already in target position
            if (hasAriaOpen && expanded === "true") return;
            if (hasAriaClose && expanded !== "true") return;

            if (role === "tab") {
                // Tab Pattern: Mutual exclusivity within a tablist
                const tablist = this.closest("[role='tablist']");
                const tabs = tablist.querySelectorAll('[role="tab"]');
                for (let tab of tabs) {
                    const tabControlledId = tab.getAttribute("aria-controls");
                    const tabControlledEl = document.getElementById(tabControlledId);
                    if (this === tab) {
                        tab.setAttribute("aria-selected", "true");
                        tabControlledEl.setAttribute("aria-hidden", "false");
                        if (controlsClass) tabControlledEl.classList.add(controlsClass);
                    } else {
                        tab.setAttribute("aria-selected", "false");
                        tabControlledEl.setAttribute("aria-hidden", "true");
                        if (controlsClass) tabControlledEl.classList.remove(controlsClass);
                    }
                }
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
    allControls.forEach((ctrl) => setAttributeIfChanged(ctrl, "aria-expanded", state));
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

/**
 * Applies a controller's aria-expanded value to its controlled element and
 * synchronizes any other controllers that reference the same element.
 */
function syncController(control) {
    const controlledId = control?.getAttribute?.("aria-controls");
    if (!controlledId) return;

    const controlledElement = document.getElementById(controlledId);
    if (!controlledElement) return;

    const expanded = control.getAttribute("aria-expanded") === "true";
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
                const groupedId = groupedControl.getAttribute("aria-controls");
                if (!groupedId || groupedId === controlledId) continue;
                updateAllControls(groupedId, "false");
                syncController(groupedControl);
            }
        }

        const closeOn = controlledElement.getAttribute("aria-close-on");
        if (control.hasAttribute("aria-haspopup") && closeOn !== "btn" && closeOn !== "button") {
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
    const controls = getControls(controlledId);
    if (!controls.length) return;

    // The controlled element is canonical in this direction. Update every
    // controller directly rather than depending on one controller to fan out.
    for (const control of controls) {
        setAttributeIfChanged(control, "aria-expanded", expandedValue);
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
    if (!controlledId) return;

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
function syncControlledElementState(controlledElement) {
    if (
        !controlledElement?.hasAttribute?.("state.aria-hidden") ||
        !controlledElement.hasAttribute("state-id")
    ) return;

    const value = controlledElement.getAttribute("aria-hidden");
    if (value === null) return;

    const stateIds = controlledElement.getAttribute("state-id")
        .split(",")
        .map(id => id.trim())
        .filter(Boolean);
    if (!stateIds.length) return;

    const state = {};
    for (const stateId of stateIds) {
        state[stateId] = { "aria-hidden": value };
    }

    State.setState(state, {
        localStorage:
            controlledElement.hasAttribute("state-localstorage") ||
            controlledElement.hasAttribute("state-onstoragechange")
    });
}

/**
 * Binds a global click listener to handle "click-outside" behavior for popups.
 * Conditions are defined via 'aria-close-on' attribute (outside, inside, anywhere).
 */
let popupListener = null;

function addPopupListener() {
    if (!popupListener) {
        popupListener = function (event) {
            const hasPopUps = document.querySelectorAll(
                '[aria-controls][aria-haspopup][aria-expanded="true"]'
            );

            let skipControlledId = null;
            for (let hasPopUp of hasPopUps) {
                const controlledId = hasPopUp.getAttribute("aria-controls");
                if (skipControlledId === controlledId) continue;
                if (hasPopUp.contains(event.target)) {
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

                let closeOnConditions = closeOn ? closeOn.split(",").map(c => c.trim()) : [];
                let shouldClose = false;

                for (let condition of closeOnConditions) {
                    if (condition === "outside" && !closeOnEl.contains(event.target)) {
                        shouldClose = true;
                    } else if (condition === "inside" && closeOnEl.contains(event.target)) {
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

            if (!document.querySelector('[aria-controls][aria-haspopup][aria-expanded="true"]')) {
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
        const toggleButton = event.currentTarget.matches("[aria-controls]")
            ? event.currentTarget
            : document.querySelector(`[aria-controls="${event.currentTarget.id}"]`);

        if (toggleButton) {
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
    selector: "[aria-controls]",
    callback: function (mutation) {
        initElement(mutation.target);
        syncAddedController(mutation.target);
    }
});

// Observer: Apply externally changed controller state to its controlled element.
Observer.init({
    name: "aria-controller-state",
    types: ["attributes"],
    selector: "[aria-controls]",
    attributeFilter: ["aria-expanded"],
    callback: function (mutation) {
        const element = mutation.target;
        const currentValue = element.getAttribute(mutation.attributeName);
        if (mutation.oldValue === currentValue) return;
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
