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

const setupCoolArtHdr = async () => {
    const canvas = document.getElementById("coolArt");
    if (!canvas || !(canvas instanceof HTMLCanvasElement) || !navigator.gpu) return;

    const adapter = await navigator.gpu.requestAdapter();
    if (!adapter) return;
    const device = await adapter.requestDevice();
    const context = canvas.getContext("webgpu");
    if (!context) return;

    let hdrBoost = 1.0;
    let targetBoost = 1.0;

    context.configure({
        device,
        format: "rgba16float",
        alphaMode: "opaque",
        toneMapping: { mode: "extended" }
    });

    const shaderModule = device.createShaderModule({
        code: `
            struct Uniforms {
                boost : f32,
            }
            @group(0) @binding(0) var<uniform> uniforms : Uniforms;

            @vertex
            fn vs_main(@builtin(vertex_index) vertexIndex : u32) -> @builtin(position) vec4f {
                var pos = array<vec2f, 3>(
                    vec2f(-1.0, -1.0),
                    vec2f(3.0, -1.0),
                    vec2f(-1.0, 3.0)
                );
                return vec4f(pos[vertexIndex], 0.0, 1.0);
            }

            @fragment
            fn fs_main(@builtin(position) fragCoord : vec4f) -> @location(0) vec4f {
                let uv = fragCoord.xy / vec2f(max(1.0, ${canvas.width || 300}.0), max(1.0, ${canvas.height || 150}.0));
                let base = vec3f(uv.x, uv.y, 0.5 + 0.5 * sin(uv.x * 6.2831853));
                return vec4f(base * uniforms.boost, 1.0);
            }
        `
    });

    const uniformBuffer = device.createBuffer({
        size: 16,
        usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST
    });

    const bindGroupLayout = device.createBindGroupLayout({
        entries: [{
            binding: 0,
            visibility: GPUShaderStage.FRAGMENT,
            buffer: { type: "uniform" }
        }]
    });

    const bindGroup = device.createBindGroup({
        layout: bindGroupLayout,
        entries: [{ binding: 0, resource: { buffer: uniformBuffer } }]
    });

    const pipeline = device.createRenderPipeline({
        layout: device.createPipelineLayout({ bindGroupLayouts: [bindGroupLayout] }),
        vertex: { module: shaderModule, entryPoint: "vs_main" },
        fragment: {
            module: shaderModule,
            entryPoint: "fs_main",
            targets: [{ format: "rgba16float" }]
        },
        primitive: { topology: "triangle-list" }
    });

    canvas.addEventListener("pointerenter", () => {
        targetBoost = 4.0;
    });

    canvas.addEventListener("pointerleave", () => {
        targetBoost = 1.0;
    });

    const render = () => {
        hdrBoost += (targetBoost - hdrBoost) * 0.18;
        device.queue.writeBuffer(uniformBuffer, 0, new Float32Array([hdrBoost, 0, 0, 0]));

        const encoder = device.createCommandEncoder();
        const pass = encoder.beginRenderPass({
            colorAttachments: [{
                view: context.getCurrentTexture().createView(),
                clearValue: { r: 0, g: 0, b: 0, a: 1 },
                loadOp: "clear",
                storeOp: "store"
            }]
        });
        pass.setPipeline(pipeline);
        pass.setBindGroup(0, bindGroup);
        pass.draw(3);
        pass.end();
        device.queue.submit([encoder.finish()]);

        requestAnimationFrame(render);
    };

    requestAnimationFrame(render);
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
    setupCoolArtHdr();

    const isMobileSwipeViewport = () => window.matchMedia("(max-width: 767.98px)").matches && window.innerWidth < 768;

    const nav = document.querySelector(".nav-container");

    if (nav) {
        let lastScrollLeft = nav.scrollLeft;
        let lastScrollTime = performance.now();
        let currentBlur = 0;
        let decayFrame = null;
        let isTouching = false;
        let isProgrammaticScroll = false;
        let clickScrollFrame = null;
        let lastSnappedEntry = null;
        let fallbackTimer = null;

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

        const cancelClickScroll = () => {
            if (clickScrollFrame) {
                cancelAnimationFrame(clickScrollFrame);
                clickScrollFrame = null;
            }
            if (isProgrammaticScroll) {
                isProgrammaticScroll = false;
                nav.style.scrollSnapType = "";
            }
        };

        const finishScroll = () => {
            if (isProgrammaticScroll) return;
            if (!isMobileSwipeViewport() || isTouching) return;

            const entries = Array.from(nav.querySelectorAll(".topbar-entry"));
            if (!entries.length) return;

            const navRect = nav.getBoundingClientRect();
            const navCenter = navRect.left + navRect.width / 2;

            let closestEntry = null;
            let closestDistance = Infinity;

            entries.forEach(entry => {
                const entryRect = entry.getBoundingClientRect();
                const entryCenter = entryRect.left + entryRect.width / 2;
                const distance = Math.abs(navCenter - entryCenter);
                if (distance < closestDistance) {
                    closestDistance = distance;
                    closestEntry = entry;
                }
            });

            if (closestEntry && closestEntry !== lastSnappedEntry) {
                lastSnappedEntry = closestEntry;
                closestEntry.click();
            }
        };

        nav.addEventListener("click", (e) => {
            if (!isMobileSwipeViewport()) return;
            const entry = e.target.closest(".topbar-entry");
            if (!entry || !nav.contains(entry)) return;

            cancelClickScroll();
            lastSnappedEntry = entry;
            isProgrammaticScroll = true;
            nav.style.scrollSnapType = "none";

            const startTime = performance.now();
            const duration = 280;

            const step = (now) => {
                if (!isMobileSwipeViewport()) {
                    cancelClickScroll();
                    return;
                }
                const elapsed = now - startTime;
                const progress = Math.min(1, elapsed / duration);
                const ease = 1 - Math.pow(1 - progress, 3);

                const navRect = nav.getBoundingClientRect();
                const entryRect = entry.getBoundingClientRect();
                const remaining = (entryRect.left + entryRect.width / 2) - (navRect.left + navRect.width / 2);

                if (progress >= 1 || Math.abs(remaining) < 0.5) {
                    nav.scrollLeft += remaining;
                    clickScrollFrame = null;
                    isProgrammaticScroll = false;
                    nav.style.scrollSnapType = "";
                    return;
                }

                const stepFactor = Math.max(0.22, ease * 0.45);
                nav.scrollLeft += remaining * stepFactor;
                clickScrollFrame = requestAnimationFrame(step);
            };

            clickScrollFrame = requestAnimationFrame(step);
        });

        nav.addEventListener("touchstart", () => {
            if (!isMobileSwipeViewport()) return;
            isTouching = true;
            cancelClickScroll();
            clearTimeout(fallbackTimer);
        }, { passive: true });

        nav.addEventListener("touchend", () => {
            if (!isMobileSwipeViewport()) return;
            isTouching = false;
            if (!("onscrollend" in window)) {
                clearTimeout(fallbackTimer);
                fallbackTimer = setTimeout(finishScroll, 250);
            }
        }, { passive: true });

        nav.addEventListener("scrollend", () => {
            if (!isMobileSwipeViewport()) return;
            finishScroll();
        }, { passive: true });

        const updateNavOverflow = () => {
            const isScrollable = nav.scrollWidth > nav.clientWidth + 1;
            const now = performance.now();
            const dt = now - lastScrollTime;
            const dx = Math.abs(nav.scrollLeft - lastScrollLeft);

            if (isScrollable && dt > 0 && dx > 0) {
                const velocity = dx / dt;
                const targetBlur = velocity > 0.2 ? Math.min(4, (velocity - 0.6) * 5) : 0;
                currentBlur = Math.max(currentBlur, targetBlur);
                nav.style.setProperty("--scroll-blur", `${currentBlur.toFixed(2)}px`);

                if (!decayFrame && currentBlur > 0) {
                    decayFrame = requestAnimationFrame(decayBlur);
                }

                if (!("onscrollend" in window) && isMobileSwipeViewport() && !isTouching && !isProgrammaticScroll) {
                    clearTimeout(fallbackTimer);
                    fallbackTimer = setTimeout(finishScroll, 250);
                }
            } else if (!isScrollable) {
                currentBlur = 0;
                nav.style.setProperty("--scroll-blur", "0px");
            }

            lastScrollLeft = nav.scrollLeft;
            lastScrollTime = now;

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

        window.addEventListener("resize", () => {
            if (!isMobileSwipeViewport()) {
                isTouching = false;
                clearTimeout(fallbackTimer);
                cancelClickScroll();
            }
            updateNavOverflow();
        }, { passive: true });

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