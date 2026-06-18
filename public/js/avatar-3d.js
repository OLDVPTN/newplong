import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";

// Avatar 3D Customization
const AVATAR_3D_CONFIG = {
    skinTone: '#E8D4C4',
    hairColor: '#2C1810',
    hairStyle: '18',
    topColor: '#2980B9',
    bottomColor: '#2C3E50',
    shoeColor: '#1A1A1A'
};

function getAvatarAuthToken() {
    try {
        return localStorage.getItem('vkm_token') || '';
    } catch (error) {
        return '';
    }
}

function getAvatarAuthHeaders(extra = {}) {
    const token = getAvatarAuthToken();
    return token ? { ...extra, Authorization: `Bearer ${token}` } : extra;
}

function getLocalAvatarConfig() {
    try {
        const raw = localStorage.getItem('vkm_avatar_3d_config');
        return raw ? JSON.parse(raw) : null;
    } catch (error) {
        return null;
    }
}

function saveLocalAvatarConfig(config) {
    try {
        localStorage.setItem('vkm_avatar_3d_config', JSON.stringify(config));
    } catch (error) {}
}

function applyAvatarConfigData(avatar) {
    if (!avatar) return;
    AVATAR_3D_CONFIG.skinTone = avatar.skin_tone || avatar.skinTone || AVATAR_3D_CONFIG.skinTone;
    AVATAR_3D_CONFIG.hairColor = avatar.hair_color || avatar.hairColor || AVATAR_3D_CONFIG.hairColor;
    AVATAR_3D_CONFIG.hairStyle = avatar.hair_style || avatar.hairStyle || AVATAR_3D_CONFIG.hairStyle;
    AVATAR_3D_CONFIG.topColor = avatar.top_color || avatar.topColor || AVATAR_3D_CONFIG.topColor;
    AVATAR_3D_CONFIG.bottomColor = avatar.bottom_color || avatar.bottomColor || AVATAR_3D_CONFIG.bottomColor;
    AVATAR_3D_CONFIG.shoeColor = avatar.shoe_color || avatar.shoeColor || AVATAR_3D_CONFIG.shoeColor;
}

function currentAvatarPayload() {
    return {
        skin_tone: AVATAR_3D_CONFIG.skinTone,
        hair_color: AVATAR_3D_CONFIG.hairColor,
        hair_style: AVATAR_3D_CONFIG.hairStyle,
        top_color: AVATAR_3D_CONFIG.topColor,
        bottom_color: AVATAR_3D_CONFIG.bottomColor,
        shoe_color: AVATAR_3D_CONFIG.shoeColor
    };
}


let avatar3DScene = null;
let avatar3DRenderer = null;
let avatar3DCamera = null;
let avatar3DModel = null;
let avatar3DAnimationId = null;
let autoRotate = false;

// Initialize Three.js Scene
function initAvatar3DScene(container) {
    // Clear previous scene
    if (avatar3DRenderer) {
        container.innerHTML = '';
        cancelAnimationFrame(avatar3DAnimationId);
    }

    // Create scene
    avatar3DScene = new THREE.Scene();
    avatar3DScene.background = new THREE.Color(0xf1f5f9);

    // Create camera
    const width = container.clientWidth;
    const height = container.clientHeight;
    avatar3DCamera = new THREE.PerspectiveCamera(50, width / height, 0.1, 100);
    avatar3DCamera.position.set(0, 1.5, 3);

    // Create renderer
    avatar3DRenderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    avatar3DRenderer.setSize(width, height);
    avatar3DRenderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    avatar3DRenderer.shadowMap.enabled = true;
    container.appendChild(avatar3DRenderer.domElement);

    // Add lights
    const ambientLight = new THREE.AmbientLight(0xffffff, 0.6);
    avatar3DScene.add(ambientLight);

    const directionalLight1 = new THREE.DirectionalLight(0xffffff, 1);
    directionalLight1.position.set(5, 10, 7.5);
    directionalLight1.castShadow = true;
    avatar3DScene.add(directionalLight1);

    const directionalLight2 = new THREE.DirectionalLight(0xffffff, 0.5);
    directionalLight2.position.set(-5, 5, -7.5);
    avatar3DScene.add(directionalLight2);

    // Load avatar model
    loadAvatar3DModel();

    // Handle resize
    window.addEventListener('resize', handleAvatar3DResize);

    // Start animation loop
    animateAvatar3D();
}

// Load 3D Avatar Model
function loadAvatar3DModel() {
    const loader = new GLTFLoader();
    loader.load('/assets/models/drex-avatar/Default.glb', (gltf) => {
        avatar3DModel = gltf.scene.clone();

        // Apply current configuration
        updateAvatar3DColors();

        // Enable shadows
        avatar3DModel.traverse((child) => {
            if (child.isMesh) {
                child.castShadow = true;
                child.receiveShadow = true;
            }
        });

        avatar3DScene.add(avatar3DModel);

        // Hide loading indicator
        const loading = document.querySelector('.avatar-3d-loading');
        if (loading) loading.style.display = 'none';

        // Update color buttons
        updateAvatar3DColorButtons();
    }, undefined, (error) => {
        console.error('Error loading avatar model:', error);
        const loading = document.querySelector('.avatar-3d-loading');
        if (loading) {
            loading.innerHTML = '<i class="fas fa-exclamation-circle"></i><span>Gagal memuat avatar</span>';
        }
    });
}

// Update Avatar Colors
function updateAvatar3DColors() {
    if (!avatar3DModel) return;

    avatar3DModel.traverse((child) => {
        if (child.isMesh && child.material) {
            const material = child.material.clone();

            // Apply skin tone
            if (isBodyMaterial(material)) {
                material.color.set(AVATAR_3D_CONFIG.skinTone);
                material.roughness = 0.8;
                material.metalness = 0.1;
            }

            // Apply hair color
            if (isHairMaterial(material)) {
                material.color.set(AVATAR_3D_CONFIG.hairColor);
                material.roughness = 0.7;
                material.metalness = 0.2;
            }

            // Apply top color
            if (isTopMaterial(material)) {
                material.color.set(AVATAR_3D_CONFIG.topColor);
                material.roughness = 0.9;
                material.metalness = 0.05;
            }

            // Apply bottom color
            if (isBottomMaterial(material)) {
                material.color.set(AVATAR_3D_CONFIG.bottomColor);
                material.roughness = 0.9;
                material.metalness = 0.05;
            }

            // Apply shoe color
            if (isShoeMaterial(material)) {
                material.color.set(AVATAR_3D_CONFIG.shoeColor);
                material.roughness = 0.8;
                material.metalness = 0.1;
            }

            child.material = material;
        }
    });

    updateConfigPreview();
}

// Material detection helpers
function isBodyMaterial(material) {
    const name = material.name?.toLowerCase() || '';
    return name.includes('body') || name.includes('skin');
}

function isHairMaterial(material) {
    const name = material.name?.toLowerCase() || '';
    return name.includes('hair');
}

function isTopMaterial(material) {
    const name = material.name?.toLowerCase() || '';
    return name.includes('top') || name.includes('shirt');
}

function isBottomMaterial(material) {
    const name = material.name?.toLowerCase() || '';
    return name.includes('bottom') || name.includes('pants');
}

function isShoeMaterial(material) {
    const name = material.name?.toLowerCase() || '';
    return name.includes('footwear') || name.includes('shoe');
}

// Animation Loop
function animateAvatar3D() {
    avatar3DAnimationId = requestAnimationFrame(animateAvatar3D);

    if (avatar3DModel && autoRotate) {
        avatar3DModel.rotation.y += 0.005;
    }

    avatar3DRenderer.render(avatar3DScene, avatar3DCamera);
}

// Handle Window Resize
function handleAvatar3DResize() {
    const container = document.getElementById('avatar-3d-canvas-container');
    if (!container || !avatar3DCamera || !avatar3DRenderer) return;

    const width = container.clientWidth;
    const height = container.clientHeight;

    avatar3DCamera.aspect = width / height;
    avatar3DCamera.updateProjectionMatrix();

    avatar3DRenderer.setSize(width, height);
}

// Update Color Buttons State
function updateAvatar3DColorButtons() {
    document.querySelectorAll('.avatar-3d-color-btn').forEach(btn => {
        const type = btn.dataset.type;
        const color = btn.dataset.color;

        let isActive = false;
        switch (type) {
            case 'skin':
                isActive = color === AVATAR_3D_CONFIG.skinTone;
                break;
            case 'hair':
                isActive = color === AVATAR_3D_CONFIG.hairColor;
                break;
            case 'top':
                isActive = color === AVATAR_3D_CONFIG.topColor;
                break;
            case 'bottom':
                isActive = color === AVATAR_3D_CONFIG.bottomColor;
                break;
            case 'shoe':
                isActive = color === AVATAR_3D_CONFIG.shoeColor;
                break;
        }

        btn.classList.toggle('active', isActive);
    });
}

// Update Configuration Preview
function updateConfigPreview() {
    const preview = document.getElementById('avatar-3d-config-preview');
    if (!preview) return;

    preview.innerHTML = `
        <div class="config-preview-item">
            <div class="color-preview" style="background-color: ${AVATAR_3D_CONFIG.skinTone}"></div>
            <span>Kulit</span>
        </div>
        <div class="config-preview-item">
            <div class="color-preview" style="background-color: ${AVATAR_3D_CONFIG.hairColor}"></div>
            <span>Rambut</span>
        </div>
        <div class="config-preview-item">
            <div class="color-preview" style="background-color: ${AVATAR_3D_CONFIG.topColor}"></div>
            <span>Baju</span>
        </div>
        <div class="config-preview-item">
            <div class="color-preview" style="background-color: ${AVATAR_3D_CONFIG.bottomColor}"></div>
            <span>Celana</span>
        </div>
        <div class="config-preview-item">
            <div class="color-preview" style="background-color: ${AVATAR_3D_CONFIG.shoeColor}"></div>
            <span>Sepatu</span>
        </div>
    `;
}

// Event Listeners
document.addEventListener('DOMContentLoaded', () => {
    // Initialize when Avatar World page is shown
    const observer = new MutationObserver((mutations) => {
        mutations.forEach((mutation) => {
            mutation.addedNodes.forEach((node) => {
                if (node.id === 'pg-avatar-world' && node.classList.contains('on')) {
                    const container = document.getElementById('avatar-3d-canvas-container');
                    if (container) {
                        initAvatar3DScene(container);
                    }
                }
            });
        });
    });

    const mainElement = document.getElementById('main');
    if (mainElement) {
        observer.observe(mainElement, { childList: true, subtree: true });
    }

    // Tab switching
    document.querySelectorAll('.avatar-3d-tab').forEach(tab => {
        tab.addEventListener('click', () => {
            // Update active tab
            document.querySelectorAll('.avatar-3d-tab').forEach(t => t.classList.remove('active'));
            tab.classList.add('active');

            // Show corresponding content
            const tabId = tab.dataset.tab;
            document.querySelectorAll('.avatar-3d-tab-content').forEach(content => {
                content.style.display = content.id === `avatar-3d-tab-${tabId}` ? 'block' : 'none';
            });
        });
    });

    // Color button clicks
    document.querySelectorAll('.avatar-3d-color-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            const type = btn.dataset.type;
            const color = btn.dataset.color;

            if (type && color) {
                switch (type) {
                    case 'skin':
                        AVATAR_3D_CONFIG.skinTone = color;
                        break;
                    case 'hair':
                        AVATAR_3D_CONFIG.hairColor = color;
                        break;
                    case 'top':
                        AVATAR_3D_CONFIG.topColor = color;
                        break;
                    case 'bottom':
                        AVATAR_3D_CONFIG.bottomColor = color;
                        break;
                    case 'shoe':
                        AVATAR_3D_CONFIG.shoeColor = color;
                        break;
                }

                updateAvatar3DColors();
                updateAvatar3DColorButtons();
            }
        });
    });

    // Rotate toggle button
    const rotateToggle = document.getElementById('avatar-3d-rotate-toggle');
    if (rotateToggle) {
        rotateToggle.addEventListener('click', () => {
            autoRotate = !autoRotate;
            rotateToggle.classList.toggle('active', autoRotate);
        });
    }

    // Reset button
    const resetBtn = document.getElementById('avatar-3d-reset');
    if (resetBtn) {
        resetBtn.addEventListener('click', () => {
            AVATAR_3D_CONFIG.skinTone = '#E8D4C4';
            AVATAR_3D_CONFIG.hairColor = '#2C1810';
            AVATAR_3D_CONFIG.hairStyle = '18';
            AVATAR_3D_CONFIG.topColor = '#2980B9';
            AVATAR_3D_CONFIG.bottomColor = '#2C3E50';
            AVATAR_3D_CONFIG.shoeColor = '#1A1A1A';

            updateAvatar3DColors();
            updateAvatar3DColorButtons();
        });
    }

    // Random button
    const randomBtn = document.getElementById('avatar-3d-random');
    if (randomBtn) {
        randomBtn.addEventListener('click', () => {
            const randomColor = () => '#' + Math.floor(Math.random() * 16777215).toString(16).padStart(6, '0');

            const skinTones = ['#F5E6D3', '#E8D4C4', '#D4B896', '#C4A484', '#A67B5B', '#8B6914', '#5C3A21'];
            const outfitColors = ['#2C3E50', '#1A1A1A', '#FFFFFF', '#808080', '#C0392B', '#2980B9', '#27AE60', '#F39C12', '#8E44AD', '#E91E63', '#16A085', '#E67E22'];

            AVATAR_3D_CONFIG.skinTone = skinTones[Math.floor(Math.random() * skinTones.length)];
            AVATAR_3D_CONFIG.hairColor = randomColor();
            AVATAR_3D_CONFIG.topColor = outfitColors[Math.floor(Math.random() * outfitColors.length)];
            AVATAR_3D_CONFIG.bottomColor = outfitColors[Math.floor(Math.random() * outfitColors.length)];
            AVATAR_3D_CONFIG.shoeColor = outfitColors[Math.floor(Math.random() * outfitColors.length)];

            updateAvatar3DColors();
            updateAvatar3DColorButtons();
        });
    }

    // Save button
    const saveBtn = document.getElementById('avatar-3d-save');
    if (saveBtn) {
        saveBtn.addEventListener('click', async () => {
            try {
                const payload = currentAvatarPayload();
                saveLocalAvatarConfig(payload);

                const token = getAvatarAuthToken();
                if (!token) {
                    showToast('Avatar disimpan di perangkat ini. Login untuk sinkron ke akun.');
                    return;
                }

                const response = await fetch('/api/avatar/config', {
                    method: 'POST',
                    headers: getAvatarAuthHeaders({ 'Content-Type': 'application/json' }),
                    body: JSON.stringify(payload)
                });

                if (response.ok) {
                    showToast('Avatar berhasil disimpan!');
                } else if (response.status === 401) {
                    showToast('Sesi login berakhir. Avatar tetap disimpan lokal.', 'error');
                } else {
                    throw new Error('Gagal menyimpan avatar');
                }
            } catch (error) {
                console.error('Error saving avatar:', error);
                showToast('Gagal menyimpan avatar', 'error');
            }
        });
    }

    // Load saved configuration when page loads
    loadAvatar3DConfig();
});

// Load saved configuration
async function loadAvatar3DConfig() {
    try {
        const localConfig = getLocalAvatarConfig();
        if (localConfig) {
            applyAvatarConfigData(localConfig);
            updateAvatar3DColors();
            updateAvatar3DColorButtons();
        }

        const token = getAvatarAuthToken();
        if (!token) {
            return;
        }

        const response = await fetch('/api/avatar/config', {
            headers: getAvatarAuthHeaders()
        });

        if (response.ok) {
            const data = await response.json();
            if (data.avatar) {
                applyAvatarConfigData(data.avatar);
                saveLocalAvatarConfig(currentAvatarPayload());
                updateAvatar3DColors();
                updateAvatar3DColorButtons();
            }
        } else if (response.status === 401) {
            // User belum login atau token expired. Jangan spam console dengan error.
            return;
        }
    } catch (error) {
        console.warn('Avatar config memakai fallback lokal:', error);
    }
}

// Toast notification
function showToast(message, type = 'success') {
    const toast = document.getElementById('toast');
    if (toast) {
        toast.textContent = message;
        toast.classList.add('show');
        setTimeout(() => toast.classList.remove('show'), 3000);
    }
}
