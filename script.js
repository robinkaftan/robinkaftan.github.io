const applyTheme = (theme) => {
    if (theme) {
        document.body.className = theme;
    } else {
        document.body.className = "";
    }
};

let activeHighlightedElement = null;
let isReadAloudEnabled = false;

const stopReading = () => {
    if (window.speechSynthesis) {
        window.speechSynthesis.cancel();
    }
    document.querySelectorAll(".highlighted").forEach(el => el.classList.remove("highlighted"));
    try {
        const iframes = document.querySelectorAll("iframe");
        iframes.forEach(iframe => {
            try {
                iframe.contentWindow.postMessage({ type: "STOP_READING" }, "*");
            } catch (e) { }
        });
    } catch (e) { }
    activeHighlightedElement = null;
};

const setReadAloudActive = (active, broadcast = true) => {
    isReadAloudEnabled = active;
    const topReadAloud = document.querySelector(".topbar-readaloud");
    if (topReadAloud) {
        if (active) {
            topReadAloud.classList.add("activated");
        } else {
            topReadAloud.classList.remove("activated");
        }
    }

    if (active) {
        document.body.classList.add("read-aloud-active");
    } else {
        document.body.classList.remove("read-aloud-active");
        stopReading();
    }

    try {
        const iframes = document.querySelectorAll("iframe");
        iframes.forEach(iframe => {
            try {
                iframe.contentWindow.postMessage({ type: "SET_READ_ALOUD", active }, "*");
            } catch (e) { }
        });
    } catch (e) { }

    if (broadcast && window !== window.top) {
        try {
            window.top.postMessage({ type: "SET_READ_ALOUD", active }, "*");
        } catch (e) { }
    }
};

window.addEventListener("message", (event) => {
    if (!event.data) return;
    if (event.data.type === "SET_READ_ALOUD") {
        isReadAloudEnabled = event.data.active;
        if (isReadAloudEnabled) {
            document.body.classList.add("read-aloud-active");
            const topReadAloud = document.querySelector(".topbar-readaloud");
            if (topReadAloud) topReadAloud.classList.add("activated");
        } else {
            document.body.classList.remove("read-aloud-active");
            const topReadAloud = document.querySelector(".topbar-readaloud");
            if (topReadAloud) topReadAloud.classList.remove("activated");
            stopReading();
        }
    } else if (event.data.type === "STOP_READING") {
        stopReading();
    }
});

document.addEventListener("DOMContentLoaded", () => {
    const currentTheme = localStorage.getItem("theme") || "";
    applyTheme(currentTheme);

    const nav = document.querySelector(".nav-container");
    if (nav) {
        let lastScrollLeft = nav.scrollLeft;
        let lastScrollTime = performance.now();
        let currentBlur = 0;
        let decayFrame = null;

        const decayBlur = () => {
            currentBlur *= 0.78;
            if (currentBlur < 0.05) {
                currentBlur = 0;
                nav.style.setProperty("--scroll-blur", "0px");
                decayFrame = null;
                return;
            }
            nav.style.setProperty("--scroll-blur", `${currentBlur.toFixed(2)}px`);
            decayFrame = requestAnimationFrame(decayBlur);
        };

        const updateNavOverflow = () => {
            const now = performance.now();
            const dt = now - lastScrollTime;
            const dx = Math.abs(nav.scrollLeft - lastScrollLeft);

            if (dt > 0 && dx > 0) {
                const velocity = dx / dt;
                const targetBlur = velocity > 0.2 ? Math.min(4, (velocity - 0.6) * 5) : 0;
                currentBlur = Math.max(currentBlur, targetBlur);
                nav.style.setProperty("--scroll-blur", `${currentBlur.toFixed(2)}px`);

                if (!decayFrame && currentBlur > 0) {
                    decayFrame = requestAnimationFrame(decayBlur);
                }
            }

            lastScrollLeft = nav.scrollLeft;
            lastScrollTime = now;

            const isScrollable = nav.scrollWidth > nav.clientWidth + 1;
            const hasLeft = isScrollable && nav.scrollLeft > 1;
            const hasRight = isScrollable && nav.scrollLeft + nav.clientWidth < nav.scrollWidth - 1;
            nav.dataset.overflowLeft = hasLeft;
            nav.dataset.overflowRight = hasRight;

            const navRect = nav.getBoundingClientRect();
            const navCenter = navRect.left + navRect.width / 2;
            const halfWidth = navRect.width / 2;

            nav.querySelectorAll(".nav-link").forEach(item => {
                if (!isScrollable) {
                    item.style.setProperty("--edge-scale", "1");
                    item.style.setProperty("--edge-margin", "0px");
                    return;
                }

                const baseWidth = item.offsetWidth;
                const itemLeft = item.offsetLeft - nav.scrollLeft + navRect.left;
                const itemCenter = itemLeft + baseWidth / 2;
                const distanceFromCenter = Math.abs(navCenter - itemCenter);
                const normalized = halfWidth > 0 ? Math.min(1, distanceFromCenter / halfWidth) : 0;
                const eased = Math.pow(normalized, 2.5);
                const scale = 1 - (0.5 * eased);
                const marginPull = -((baseWidth * (1 - scale)) / 2);

                item.style.setProperty("--edge-scale", scale.toFixed(3));
                item.style.setProperty("--edge-margin", `${marginPull.toFixed(2)}px`);
            });
        };

        nav.addEventListener("scroll", updateNavOverflow, { passive: true });
        new ResizeObserver(updateNavOverflow).observe(nav);
        new MutationObserver(updateNavOverflow).observe(nav, { childList: true, subtree: true });
        updateNavOverflow();
    }

    const select = document.querySelector("select");
    if (select) {
        Array.from(select.options).forEach(option => {
            if (option.getAttribute("data-themename") === currentTheme) {
                option.selected = true;
            }
        });

        select.addEventListener("change", () => {
            const selectedOption = select.options[select.selectedIndex];
            const themeName = selectedOption.getAttribute("data-themename") || "";
            localStorage.setItem("theme", themeName);
            applyTheme(themeName);

            try {
                const iframes = window.top.document.querySelectorAll("iframe");
                iframes.forEach(iframe => {
                    try {
                        iframe.contentWindow.document.body.className = themeName;
                    } catch (e) { }
                });
            } catch (e) { }
        });
    }

    const navLinks = document.querySelectorAll(".nav-link");
    const iframe = document.querySelector("iframe[name='mainframe']");

    if (navLinks.length && iframe) {
        navLinks.forEach(link => {
            link.addEventListener("click", (e) => {
                e.preventDefault();
                const targetUrl = link.getAttribute("href");

                if (iframe.getAttribute("src") === targetUrl) return;

                iframe.classList.add("fade-out");

                setTimeout(() => {
                    iframe.src = targetUrl;
                    iframe.onload = () => {
                        iframe.classList.remove("fade-out");
                        try {
                            const currentTheme = localStorage.getItem("theme") || "";
                            iframe.contentWindow.document.body.className = currentTheme;
                            if (isReadAloudEnabled) {
                                iframe.contentWindow.postMessage({ type: "SET_READ_ALOUD", active: true }, "*");
                            }
                        } catch (e) { }
                    };
                }, 150);
            });
        });
    }

    const readAloudBtn = document.querySelector(".topbar-readaloud");
    if (readAloudBtn) {
        readAloudBtn.addEventListener("click", () => {
            const newState = !isReadAloudEnabled;
            setReadAloudActive(newState, true);
        });
    }

    const textSelectors = "p, a, h1, h2, h3, h4, h5, h6, span, li, label, td, th, blockquote";

    document.addEventListener("mouseover", (e) => {
        if (!isReadAloudEnabled) return;
        const target = e.target.closest(textSelectors);
        if (target && target !== readAloudBtn && !target.closest(".topbar")) {
            if (!target.classList.contains("highlighted") && target !== activeHighlightedElement) {
                target.classList.add("highlighted");
            }
        }
    });

    document.addEventListener("mouseout", (e) => {
        if (!isReadAloudEnabled) return;
        const target = e.target.closest(textSelectors);
        if (target && target !== activeHighlightedElement) {
            target.classList.remove("highlighted");
        }
    });

    document.addEventListener("click", (e) => {
        if (!isReadAloudEnabled) return;
        const target = e.target.closest(textSelectors);
        if (target && target !== readAloudBtn && !target.closest(".topbar")) {
            e.preventDefault();
            e.stopPropagation();

            if (activeHighlightedElement === target) {
                stopReading();
                return;
            }

            stopReading();

            activeHighlightedElement = target;
            target.classList.add("highlighted");

            if (window.speechSynthesis) {
                const textToRead = target.innerText || target.textContent;
                if (textToRead && textToRead.trim()) {
                    const utterance = new SpeechSynthesisUtterance(textToRead);
                    utterance.onend = () => {
                        target.classList.remove("highlighted");
                        if (activeHighlightedElement === target) {
                            activeHighlightedElement = null;
                        }
                    };
                    utterance.onerror = () => {
                        target.classList.remove("highlighted");
                        if (activeHighlightedElement === target) {
                            activeHighlightedElement = null;
                        }
                    };
                    window.speechSynthesis.speak(utterance);
                }
            }
        } else if (target === readAloudBtn) {
            stopReading();
        }
    });
});
window.addEventListener("storage", (e) => {
    if (e.key === "theme") {
        applyTheme(e.newValue || "");
        const select = document.querySelector("select");
        if (select) {
            Array.from(select.options).forEach(option => {
                if (option.getAttribute("data-themename") === (e.newValue || "")) {
                    option.selected = true;
                }
            });
        }
    }
});