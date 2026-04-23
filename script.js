const screenRoot = document.getElementById("screenRoot");
const modalRoot = document.getElementById("modalRoot");
const onboardingRoot = document.getElementById("onboardingRoot");
const pageRoot = document.querySelector(".page");
const atmStage = document.getElementById("atmStage");
const atmMachine = document.getElementById("atmMachine");
const helpSidebarButton = document.getElementById("helpSidebarButton");
const reloadPageHotspot = document.getElementById("reloadPageHotspot");
const receiptSlot = document.getElementById("receiptSlot");
const cardToggle = document.getElementById("cardToggle");
const cashSlot = document.getElementById("cashSlot");
const fingerprintReader = document.getElementById("fingerprintReader");
const cardStatus = document.getElementById("cardStatus");
const backButton = document.getElementById("backButton");
const cancelButton = document.getElementById("cancelButton");
const sideButtons = Array.from(document.querySelectorAll(".side-btn"));
const HOME_ICONS = {
  card: "assets/cartao.svg",
  fingerprint: "assets/Dedo.svg",
  phone: "assets/telefone.svg",
  hero: "assets/imagem inicio.png"
};

const account = {
  holder: "Cliente Santander",
  balance: 2450.75,
  history: [
    { label: "Saldo inicial", value: "R$ 2.450,75" }
  ]
};

const slotToIndex = {
  l1: 0,
  l2: 1,
  l3: 2,
  l4: 3,
  r1: 4,
  r2: 5,
  r3: 6,
  r4: 7
};

const state = {
  cardInserted: false,
  currentScreen: "home",
  historyStack: [],
  touchMode: false,
  pendingTimeout: null,
  homeCarouselInterval: null,
  optionByIndex: Array(8).fill(null),
  optionById: {},
  noticeTitle: "",
  noticeMessage: "",
  selectedAmount: null,
  cashDispensed: false,
  receiptDispensed: false,
  noCardAccessValidated: false,
  noCardAccessRequested: false,
  termsAccepted: false,
  activeModal: "introWarning",
  onboardingActive: false,
  onboardingStep: 0,
  hasCardPreference: null,
  hardwareAnimation: null,
  animationTimeout: null,
  nextCardAction: null
};

const CARD_READING_DELAY = 10000;

function formatCurrency(value) {
  return new Intl.NumberFormat("pt-BR", {
    style: "currency",
    currency: "BRL"
  }).format(value);
}

function clampNumber(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

function clearPendingTransition() {
  if (state.pendingTimeout) {
    window.clearTimeout(state.pendingTimeout);
    state.pendingTimeout = null;
  }
}

function updateMachineScale() {
  if (!pageRoot || !atmStage || !atmMachine) {
    return;
  }

  const pageStyles = window.getComputedStyle(pageRoot);
  const paddingX = parseFloat(pageStyles.paddingLeft) + parseFloat(pageStyles.paddingRight);
  const paddingY = parseFloat(pageStyles.paddingTop) + parseFloat(pageStyles.paddingBottom);
  const availableWidth = Math.max(window.innerWidth - paddingX, 320);
  const availableHeight = Math.max(window.innerHeight - paddingY, 320);

  atmStage.style.removeProperty("width");
  atmStage.style.removeProperty("height");
  atmStage.style.setProperty("--machine-scale", "1");

  const naturalWidth = atmMachine.offsetWidth;
  const naturalHeight = atmMachine.offsetHeight;
  const scale = Math.min(1, availableWidth / naturalWidth, availableHeight / naturalHeight);

  atmStage.style.width = `${naturalWidth * scale}px`;
  atmStage.style.height = `${naturalHeight * scale}px`;
  atmStage.style.setProperty("--machine-scale", scale.toFixed(4));
  updateHelpSidebarButton();
}

function clearHomeCarousel() {
  if (state.homeCarouselInterval) {
    window.clearInterval(state.homeCarouselInterval);
    state.homeCarouselInterval = null;
  }
}

function setTouchMode() {
  const mediaQuery = window.matchMedia("(max-width: 980px), (pointer: coarse)");
  state.touchMode = mediaQuery.matches;
  document.body.classList.toggle("touch-mode", state.touchMode);
  renderScreen();
}

function goTo(screenKey, { push = true } = {}) {
  clearPendingTransition();

  if (push && state.currentScreen !== screenKey) {
    state.historyStack.push(state.currentScreen);
  }

  state.currentScreen = screenKey;
  renderScreen();
}

function scheduleScreen(screenKey, delay) {
  clearPendingTransition();
  state.pendingTimeout = window.setTimeout(() => {
    state.pendingTimeout = null;
    goTo(screenKey, { push: false });
  }, delay);
}

function normalizeOptions(options) {
  return options.map((option, index) => {
    const indices = option.indices
      || (option.slot ? [slotToIndex[option.slot]] : [])
        .filter((value) => value !== undefined);

    return {
      ...option,
      id: option.id || `option-${index}`,
      indices
    };
  });
}

function renderTouchClass() {
  return state.touchMode ? "touch-enabled" : "touch-disabled";
}

function renderTouchNote() {
  return state.touchMode
    ? '<p class="touch-only-note">Modo touch ativo: toque diretamente nas opções da tela.</p>'
    : "";
}

function isModalOpen() {
  return Boolean(state.activeModal);
}

function isOnboardingOpen() {
  return state.onboardingActive;
}

function isInteractionLocked() {
  return isModalOpen() || isOnboardingOpen() || Boolean(state.hardwareAnimation);
}

function updateDispenseSlots() {
  if (receiptSlot) {
    receiptSlot.classList.toggle("is-printing", state.hardwareAnimation === "paper");
    receiptSlot.classList.toggle("has-paper", state.receiptDispensed);
    receiptSlot.disabled = !state.receiptDispensed || isInteractionLocked();

    const receiptLabel = receiptSlot.querySelector(".slot-label");
    if (receiptLabel) {
      receiptLabel.textContent = state.receiptDispensed
        ? "Retire o demonstrativo"
        : "Retire seu impresso";
    }
  }

  if (cashSlot) {
    cashSlot.classList.toggle("is-dispensing", state.hardwareAnimation === "cash");
    cashSlot.classList.toggle("has-money", state.cashDispensed);
    cashSlot.disabled = !state.cashDispensed || isInteractionLocked();

    const cashLabel = cashSlot.querySelector(".slot-label");
    if (cashLabel) {
      cashLabel.textContent = state.cashDispensed
        ? "Retire seu dinheiro"
        : "Saída de dinheiro";
    }
  }
}

function clearDispensedItems({ keepSelection = false } = {}) {
  state.cashDispensed = false;
  state.receiptDispensed = false;

  if (!keepSelection) {
    state.selectedAmount = null;
  }

  updateDispenseSlots();
}

function resetSessionArtifacts({ keepSelection = false } = {}) {
  clearPendingTransition();
  clearHardwareAnimation();
  clearDispensedItems({ keepSelection });
  state.noCardAccessValidated = false;
  state.noCardAccessRequested = false;
  state.historyStack = [];
}

function renderHomeInstruction() {
  if (state.noCardAccessValidated) {
    return `
      <div class="instruction-line">
        <strong>Biometria validada</strong><br>
        Use Acesso sem cartão para continuar.
      </div>
    `;
  }

  if (state.hasCardPreference === false) {
    return `
      <div class="instruction-line">
        <strong>Você está sem cartão</strong><br>
        Selecione Acesso sem cartão para continuar.
      </div>
    `;
  }

  return `
    <div class="instruction-line instruction-line-with-icon">
      <span class="instruction-card-icon" aria-hidden="true">
        <img src="${HOME_ICONS.card}" alt="">
      </span>
      <span class="instruction-copy">
        <strong>Coloque seu cartão</strong><br>
        ou escolha uma opção.
      </span>
    </div>
  `;
}

function renderTopline() {
  return `
    <div class="screen-topline">
      <span>Notas disponíveis: R$ 20, R$ 50 e R$ 100.</span>
      <span class="topline-brand"><span class="brand-chip">Banco24Horas</span></span>
    </div>
    <div class="screen-colorbar"></div>
  `;
}

function renderHomeAction(option) {
  const actionClass = renderTouchClass();
  const iconMarkup = option.iconSrc
    ? `
        <span class="home-option-icon ${option.iconClass}" aria-hidden="true">
          <img src="${option.iconSrc}" alt="">
        </span>
      `
    : option.icon
      ? `<span class="home-option-icon home-option-icon-text ${option.iconClass}" aria-hidden="true">${option.icon}</span>`
      : "";

  return `
    <button class="action-button b24-arrow ${actionClass}" type="button" data-option-id="${option.id}">
      <span class="action-inner">
        ${iconMarkup}
        <span class="action-copy">
          <strong>${option.label}</strong>
          <span>${option.hint}</span>
        </span>
      </span>
    </button>
  `;
}

function renderBankButton(option) {
  const actionClass = renderTouchClass();
  const wideClass = option.wide ? "wide" : "";
  const subtitle = option.hint ? `<small>${option.hint}</small>` : "";
  return `
    <button class="action-button bank-pill ${wideClass} ${actionClass}" type="button" data-option-id="${option.id}">
      <span>
        ${option.label}
        ${subtitle}
      </span>
    </button>
  `;
}

function renderCornerButton(option) {
  const actionClass = renderTouchClass();
  return `
    <button class="action-button corner-pill ${actionClass}" type="button" data-option-id="${option.id}">
      ${option.label}
    </button>
  `;
}

function renderReceipt(lines) {
  const rows = lines.map(([label, value]) => `
    <div class="receipt-line">
      <span>${label}</span>
      <strong>${value}</strong>
    </div>
  `).join("");

  return `
    <div class="receipt-card">
      <h2>Comprovante resumido</h2>
      ${rows}
    </div>
  `;
}

function getOnboardingSteps() {
  const interactionStep = state.touchMode
    ? {
      target: "#screenRoot",
      placement: "bottom",
      title: "Toque na própria tela",
      description: "Neste modo, você pode tocar diretamente na opção que aparecer na tela. Toque com calma e espere a próxima mensagem."
    }
    : {
      target: ".left-buttons",
      placement: "right",
      title: "Botões laterais",
      description: "Os botões laterais ficam na mesma altura das opções da tela. Se a opção estiver na segunda linha, aperte o segundo botão."
    };

  return [
    {
      placement: "center",
      title: "Vamos treinar com calma",
      description: "Vou mostrar rapidamente onde fica cada parte importante deste caixa. Você pode pular esta explicação clicando no botão \"X\" localizado no canto superior direito, se preferir."
    },
    {
      target: "#screenRoot",
      placement: "bottom",
      title: "Tela principal",
      description: "As mensagens e as opções aparecem nesta tela. Leia com calma antes de fazer qualquer escolha."
    },
    interactionStep,
    {
      target: "#cardToggle",
      placement: "top",
      title: "Leitor de cartão",
      description: "Se você estiver com cartão, é aqui que o cartão entra e sai durante a simulação."
    },
    {
      target: "#fingerprintReader",
      placement: "left",
      title: "Leitor biométrico",
      description: "Se você estiver sem cartão, a entrada pode ser feita pela biometria neste leitor."
    },
    {
      target: ".hardware-row",
      placement: "top",
      title: "Saída de papel e dinheiro",
      description: "O papel sai no compartimento da esquerda. O dinheiro sai no compartimento maior, abaixo da leitora de cartão."
    }
  ];
}

function getOnboardingLayout(step) {
  if (!step.target) {
    return {
      highlightMarkup: "",
      cardClass: "is-centered",
      cardStyle: ""
    };
  }

  const target = document.querySelector(step.target);
  if (!target || target.getBoundingClientRect().width === 0 || target.getBoundingClientRect().height === 0) {
    return {
      highlightMarkup: "",
      cardClass: "is-centered",
      cardStyle: ""
    };
  }

  const rect = target.getBoundingClientRect();
  const spotlightPadding = 16;
  const safeMargin = 18;
  const gap = 24;
  const estimatedCardWidth = Math.min(window.innerWidth - (safeMargin * 2), 420);
  const estimatedCardHeight = Math.min(window.innerHeight - (safeMargin * 2), 420);
  const highlightWidth = Math.min(rect.width + (spotlightPadding * 2), window.innerWidth - (safeMargin * 2));
  const highlightHeight = Math.min(rect.height + (spotlightPadding * 2), window.innerHeight - (safeMargin * 2));
  const highlightTop = clampNumber(rect.top - spotlightPadding, safeMargin, window.innerHeight - highlightHeight - safeMargin);
  const highlightLeft = clampNumber(rect.left - spotlightPadding, safeMargin, window.innerWidth - highlightWidth - safeMargin);
  let top = rect.bottom + gap;
  let left = rect.left + (rect.width / 2) - (estimatedCardWidth / 2);

  if (step.placement === "top") {
    top = rect.top - estimatedCardHeight - gap;
  }

  if (step.placement === "left") {
    top = rect.top + (rect.height / 2) - (estimatedCardHeight / 2);
    left = rect.left - estimatedCardWidth - gap;
  }

  if (step.placement === "right") {
    top = rect.top + (rect.height / 2) - (estimatedCardHeight / 2);
    left = rect.right + gap;
  }

  top = clampNumber(top, safeMargin, window.innerHeight - estimatedCardHeight - safeMargin);
  left = clampNumber(left, safeMargin, window.innerWidth - estimatedCardWidth - safeMargin);

  const highlightMarkup = `
    <div
      class="onboarding-highlight"
      style="
        top: ${highlightTop}px;
        left: ${highlightLeft}px;
        width: ${highlightWidth}px;
        height: ${highlightHeight}px;
      "
    ></div>
  `;

  return {
    highlightMarkup,
    cardClass: `is-${step.placement || "bottom"}`,
    cardStyle: `top: ${top}px; left: ${left}px;`
  };
}

function clampOnboardingCardPosition() {
  const onboardingCard = onboardingRoot?.querySelector(".onboarding-card");
  if (!onboardingCard || onboardingCard.classList.contains("is-centered")) {
    return;
  }

  const safeMargin = 18;
  const rect = onboardingCard.getBoundingClientRect();
  const maxTop = Math.max(window.innerHeight - rect.height - safeMargin, safeMargin);
  const maxLeft = Math.max(window.innerWidth - rect.width - safeMargin, safeMargin);
  const clampedTop = clampNumber(rect.top, safeMargin, maxTop);
  const clampedLeft = clampNumber(rect.left, safeMargin, maxLeft);

  onboardingCard.style.top = `${clampedTop}px`;
  onboardingCard.style.left = `${clampedLeft}px`;
}

function renderOnboarding() {
  if (!onboardingRoot) {
    return;
  }

  if (!state.onboardingActive) {
    onboardingRoot.innerHTML = "";
    return;
  }

  const steps = getOnboardingSteps();
  state.onboardingStep = clampNumber(state.onboardingStep, 0, steps.length - 1);
  const step = steps[state.onboardingStep];
  const isLastStep = state.onboardingStep === steps.length - 1;
  const layout = getOnboardingLayout(step);
  const isFirstStep = state.onboardingStep === 0;

  onboardingRoot.innerHTML = `
    <div class="onboarding-overlay" role="presentation">
      ${layout.highlightMarkup}
      <section
        class="onboarding-card ${layout.cardClass}"
        role="dialog"
        aria-modal="true"
        aria-labelledby="onboardingTitle"
        aria-describedby="onboardingDescription"
        ${layout.cardStyle ? `style="${layout.cardStyle}"` : ""}
      >
        <button
          class="onboarding-close"
          type="button"
          aria-label="Pular explicação"
          title="Pular explicação"
          data-onboarding-action="skip"
        >
          X
        </button>
        <span class="onboarding-step-label">Explicação ${state.onboardingStep + 1} de ${steps.length}</span>
        <h2 id="onboardingTitle">${step.title}</h2>
        <p id="onboardingDescription">${step.description}</p>
        <div class="onboarding-actions">
          <button
            class="onboarding-button secondary"
            type="button"
            data-onboarding-action="back"
            ${isFirstStep ? "disabled" : ""}
          >
            Voltar
          </button>
          <button class="onboarding-button primary" type="button" data-onboarding-action="next">
            ${isLastStep ? "Entendi, vamos começar" : "Próximo"}
          </button>
        </div>
      </section>
    </div>
  `;

  window.requestAnimationFrame(clampOnboardingCardPosition);
}

function openOnboarding() {
  closeModal();
  state.onboardingStep = 0;
  state.onboardingActive = true;
  renderOnboarding();
  updateSideButtons();
  updateDispenseSlots();
  updateHelpSidebarButton();
}

function closeOnboarding() {
  state.onboardingActive = false;
  renderOnboarding();
  updateSideButtons();
  updateDispenseSlots();
  updateHelpSidebarButton();
}

function goToPreviousOnboardingStep() {
  state.onboardingStep = clampNumber(state.onboardingStep - 1, 0, getOnboardingSteps().length - 1);
  renderOnboarding();
}

function goToNextOnboardingStep() {
  const lastIndex = getOnboardingSteps().length - 1;

  if (state.onboardingStep >= lastIndex) {
    closeOnboarding();
    return;
  }

  state.onboardingStep += 1;
  renderOnboarding();
}

function renderModal() {
  if (!modalRoot) {
    return;
  }

  if (!state.activeModal) {
    modalRoot.innerHTML = "";
    return;
  }

  if (state.activeModal === "introWarning") {
    modalRoot.innerHTML = `
      <div class="modal-overlay" role="presentation">
        <section
          class="modal-card modal-card-intro"
          role="dialog"
          aria-modal="true"
          aria-labelledby="introWarningTitle"
          aria-describedby="introWarningDescription"
        >
          <span class="modal-eyebrow">Aviso inicial</span>
          <h2 id="introWarningTitle">Este ATM é apenas um simulador.</h2>
          <p id="introWarningDescription">
            Este protótipo existe somente para demonstração visual e navegação de fluxo.
            Nenhum dado digitado aqui será armazenado, compartilhado ou utilizado fora da simulação.
          </p>
          <p>
            Ao continuar, você confirma que leu este aviso e deseja prosseguir com o protótipo.
          </p>
          <div class="modal-actions">
            <button class="modal-button primary" type="button" data-intro-continue>
              Li o aviso e quero continuar
            </button>
          </div>
        </section>
      </div>
    `;
    return;
  }

  if (state.activeModal === "biometricQuestion") {
    modalRoot.innerHTML = `
      <div class="modal-overlay" role="presentation">
        <section
          class="modal-card"
          role="dialog"
          aria-modal="true"
          aria-labelledby="biometricQuestionTitle"
          aria-describedby="biometricQuestionDescription"
        >
          <span class="modal-eyebrow">Biometria</span>
          <h2 id="biometricQuestionTitle">Acesso sem cartão selecionado</h2>
          <p id="biometricQuestionDescription">
            Para continuar, toque no leitor biométrico à direita, logo abaixo da tela.
            Você pode usar dedo ou palma da mão.
          </p>
          <div class="modal-actions modal-actions-center">
            <button class="modal-button primary" type="button" data-biometric-choice="continue">
              Entendi
            </button>
          </div>
        </section>
      </div>
    `;
    return;
  }

  modalRoot.innerHTML = `
    <div class="modal-overlay" role="presentation">
      <section
        class="modal-card"
        role="dialog"
        aria-modal="true"
        aria-labelledby="cardQuestionTitle"
        aria-describedby="cardQuestionDescription"
      >
        <span class="modal-eyebrow">Primeiro passo</span>
        <h2 id="cardQuestionTitle">Você está com cartão?</h2>
        <p id="cardQuestionDescription">
          Escolha como deseja iniciar o atendimento para seguirmos com o fluxo correto.
        </p>
        <div class="modal-actions">
          <button class="modal-button secondary" type="button" data-card-choice="no-card">
            Não tenho cartão
          </button>
          <button class="modal-button primary" type="button" data-card-choice="has-card">
            Tenho cartão
          </button>
        </div>
      </section>
    </div>
  `;
}

function openCardQuestionModal() {
  state.activeModal = "cardQuestion";
  renderModal();
  updateSideButtons();
  updateDispenseSlots();
  updateHelpSidebarButton();
}

function openBiometricQuestionModal() {
  state.activeModal = "biometricQuestion";
  renderModal();
  updateSideButtons();
  updateDispenseSlots();
  updateHelpSidebarButton();
}

function beginNoCardAccessFlow() {
  state.hasCardPreference = false;
  state.noCardAccessRequested = true;
  openBiometricQuestionModal();
}

function showBiometricGuidanceNotice() {
  closeModal();
  showNotice(
    "Orientação de acesso",
    "Caso não se recorde da biometria cadastrada, recomendamos iniciar com cartão. Se optar por seguir sem cartão, tente primeiro a digital no leitor do lado direito e, se necessário, a leitura da palma da mão."
  );
}

function showBiometricRememberNotice() {
  closeModal();
  showNotice(
    "Leitura biométrica",
    "Posicione o dedo ou a palma da mão no leitor biométrico localizado à direita, logo abaixo da tela, para prosseguir com o atendimento sem cartão."
  );
}

function startBiometricHardwareFlow(type) {
  if (state.cardInserted || isInteractionLocked() || !state.termsAccepted || !state.noCardAccessRequested) {
    return;
  }

  clearDispensedItems();
  state.nextCardAction = null;
  state.historyStack = [];
  state.hasCardPreference = false;
  state.noCardAccessValidated = true;
  state.noCardAccessRequested = false;
  updateMachineStatus();

  playHardwareAnimation(type, () => {
    goTo("readingCard", { push: false });
    scheduleScreen("bankMenu", CARD_READING_DELAY);
  });
}

function closeModal() {
  state.activeModal = null;
  renderModal();
  updateSideButtons();
  updateDispenseSlots();
  updateHelpSidebarButton();
}

function updateHelpSidebarButton() {
  if (!helpSidebarButton || !atmStage) {
    return;
  }

  const shouldShow = state.currentScreen === "home" && !state.onboardingActive && !state.activeModal;
  helpSidebarButton.hidden = !shouldShow;

  if (!shouldShow) {
    return;
  }

  helpSidebarButton.classList.remove("is-bottom-docked");
  helpSidebarButton.style.removeProperty("top");
  helpSidebarButton.style.removeProperty("left");
  helpSidebarButton.style.removeProperty("right");
  helpSidebarButton.style.removeProperty("bottom");

  const safeMargin = 18;
  const sideGap = 22;
  const stageRect = atmStage.getBoundingClientRect();
  const buttonRect = helpSidebarButton.getBoundingClientRect();
  const fitsOnSide = stageRect.right + sideGap + buttonRect.width <= window.innerWidth - safeMargin;

  if (fitsOnSide) {
    const top = clampNumber(
      stageRect.top + (stageRect.height / 2) - (buttonRect.height / 2),
      safeMargin,
      window.innerHeight - buttonRect.height - safeMargin
    );
    const left = stageRect.right + sideGap;

    helpSidebarButton.style.top = `${top}px`;
    helpSidebarButton.style.left = `${left}px`;
    return;
  }

  helpSidebarButton.classList.add("is-bottom-docked");
}

function clearHardwareAnimation() {
  if (state.animationTimeout) {
    window.clearTimeout(state.animationTimeout);
    state.animationTimeout = null;
  }

  state.hardwareAnimation = null;
  cardToggle.classList.remove("is-animating-card");
  if (fingerprintReader) {
    fingerprintReader.classList.remove("is-animating-pulse", "is-animating-finger");
  }
  updateMachineStatus();
  updateDispenseSlots();
  updateSideButtons();
}

function playHardwareAnimation(type, onComplete, duration = 2100) {
  clearHardwareAnimation();
  state.hardwareAnimation = type;

  if (type === "card") {
    cardToggle.classList.add("is-animating-card");
  }

  if (fingerprintReader) {
    fingerprintReader.classList.toggle("is-animating-pulse", type === "pulse");
    fingerprintReader.classList.toggle("is-animating-finger", type === "finger");
  }

  updateMachineStatus();
  updateDispenseSlots();
  updateSideButtons();

  state.animationTimeout = window.setTimeout(() => {
    state.animationTimeout = null;
    clearHardwareAnimation();
    onComplete();
  }, duration);
}

function getCurrentScreen() {
  const screens = {
    intro() {
      return {
        options: [],
        html: `
          <section class="atm-screen intro-screen">
            ${renderTopline()}
            <div class="screen-body">
              <div class="intro-card">
                <div class="intro-badge">Aviso inicial</div>
                <h1>Este ATM é apenas um simulador.</h1>
                <p>
                  Este protótipo existe somente para demonstração visual e navegação de fluxo.
                  Nenhum dado digitado aqui será armazenado, compartilhado ou utilizado fora da simulação.
                </p>
                <p>
                  Ao clicar no botão abaixo, você declara que leu este aviso e concorda em prosseguir com os termos do protótipo.
                </p>
                <button id="introStartButton" class="intro-start-button" type="button">
                  Iniciar simulador e concordar com os termos
                </button>
              </div>
            </div>
          </section>
        `
      };
    },
    home() {
      const options = normalizeOptions([
        {
          slot: "r2",
          label: "Acesso sem cartão",
          hint: "Biometria e serviços rápidos",
          iconSrc: HOME_ICONS.fingerprint,
          iconClass: "fingerprint-icon",
          action: () => state.noCardAccessValidated
            ? showNotice(
              "Acesso sem cartão",
              "Biometria já validada nesta demonstração. O restante deste fluxo sem cartão ainda está em modo demonstrativo."
            )
            : beginNoCardAccessFlow()
        },
        {
          slot: "r3",
          label: "Saque digital",
          hint: "Código QR ou token",
          iconSrc: HOME_ICONS.phone,
          iconClass: "phone-icon",
          action: () => showNotice(
            "Saque digital",
            "Este fluxo não foi incluído no simulador."
          )
        },
        {
          slot: "r4",
          label: "Recarga, vale-presente, IPVA, multas e outros",
          hint: "Serviços complementares",
          action: () => showNotice(
            "Recarga, vale-presente, IPVA, multas e outros",
            "Este fluxo não foi incluído no simulador."
          )
        }
      ]);

      return {
        options,
        html: `
          <section class="atm-screen">
            ${renderTopline()}
            <div class="screen-body">
              <div class="home-layout">
                <div class="promo-panel">
                  <div class="promo-hero-frame">
                    <img
                      class="promo-hero-image"
                      src="${HOME_ICONS.hero}"
                      alt="Pessoa segurando um cartão para representar o início do atendimento."
                    >
                  </div>
                  <div class="screen-hint">Insira o cartão ou escolha uma das opções ao lado.</div>
                </div>

                <div class="home-actions">
                  ${renderHomeInstruction()}
                  ${options.map(renderHomeAction).join("")}
                  ${renderTouchNote()}
                </div>
              </div>
            </div>
          </section>
        `
      };
    },
    readingCard() {
      return {
        options: [],
        html: `
          <section class="atm-screen">
            ${renderTopline()}
            <div class="screen-body">
              <div class="message-layout">
                <div class="screen-message-box card-warning-box">
                  <div class="card-warning-screen">
                    <p class="card-warning-topline">
                      Você está no
                      <span class="card-warning-chip">Banco24Horas</span>
                    </p>
                    <h1 class="card-warning-title">
                      <span>Atenção!</span>
                    </h1>
                    <p class="card-warning-main">
                      <span>Não retire seu cartão.</span>
                    </p>
                    <p class="card-warning-caption">
                      Por favor, aguarde a leitura dos dados.
                    </p>
                  </div>
                </div>
              </div>
            </div>
          </section>
        `
      };
    },
    bankMenu() {
      const options = normalizeOptions([
        { slot: "l1", label: "Saque", action: () => goTo("amountMenu") },
        { slot: "r1", label: "Saldo", action: () => goTo("balance") },
        {
          slot: "l2",
          label: "DinDin",
          action: () => showNotice("DinDin", "Este fluxo não foi incluído no simulador.")
        },
        { slot: "r2", label: "Extrato", action: () => startStatementFlow() },
        {
          slot: "l3",
          label: "Seguros Acidentes Pessoais",
          action: () => showNotice("Seguros Acidentes Pessoais", "Este fluxo não foi incluído no simulador.")
        },
        {
          slot: "r3",
          label: "Solicite seu cartão",
          action: () => showNotice("Solicite seu cartão", "Este fluxo não foi incluído no simulador.")
        },
        {
          slot: "l4",
          label: "Habilitar Celular para Transações",
          action: () => showNotice("Habilitar Celular para Transações", "Este fluxo não foi incluído no simulador.")
        },
        {
          slot: "r4",
          label: "Outros Serviços",
          action: () => showNotice("Outros Serviços", "Este fluxo não foi incluído no simulador.")
        }
      ]);

      return {
        options,
        html: `
          <section class="atm-screen bank-screen">
            <div class="bank-header">
              <span class="bank-logo">Santander</span>
              <span class="bank-domain">www.santander.com.br</span>
            </div>
            <div class="bank-content bank-selection-content">
              <h1 class="bank-title">Selecione a opção desejada</h1>
              <div class="bank-grid bank-selection-grid">
                ${options.map(renderBankButton).join("")}
              </div>
              ${renderTouchNote()}
            </div>
          </section>
        `
      };
    },
    amountMenu() {
      const options = normalizeOptions([
        { slot: "l1", label: "20,00", action: () => startWithdraw(20) },
        { slot: "r1", label: "150,00", action: () => startWithdraw(150) },
        { slot: "l2", label: "50,00", action: () => startWithdraw(50) },
        { slot: "r2", label: "170,00", action: () => startWithdraw(170) },
        { slot: "l3", label: "100,00", action: () => startWithdraw(100) },
        { slot: "r3", label: "200,00", action: () => startWithdraw(200) },
        {
          label: "Outros Valores",
          wide: true,
          indices: [3, 7],
          action: () => showNotice("Outros valores", "Para manter o fluxo fiel às fotos, deixei os valores fixos principais desta simulação.")
        }
      ]);

      return {
        options,
        html: `
          <section class="atm-screen bank-screen">
            <div class="bank-header">
              <span class="bank-logo">Santander</span>
              <span class="bank-domain">www.santander.com.br</span>
            </div>
            <div class="bank-content bank-selection-content">
              <h1 class="bank-title">Escolha o <strong>Valor</strong> Desejado</h1>
              <div class="bank-grid bank-selection-grid">
                ${options.map(renderBankButton).join("")}
              </div>
              ${renderTouchNote()}
            </div>
          </section>
        `
      };
    },
    processing() {
      return {
        options: [],
        html: `
          <section class="atm-screen bank-screen">
            <div class="bank-header">
              <span class="bank-logo">Santander</span>
              <span class="bank-domain">www.santander.com.br</span>
            </div>
            <div class="bank-content">
              <div class="processing-center">
                <div class="processing-inline">
                  <span class="spinner" aria-hidden="true"></span>
                  <span>Aguarde um momento</span>
                </div>
              </div>
            </div>
          </section>
        `
      };
    },
    balance() {
      const options = normalizeOptions([
        { slot: "l4", label: "Encerrar", action: () => beginCardRemoval("endSession") },
        { slot: "r4", label: "Menu principal", action: () => goTo("bankMenu", { push: false }) }
      ]);

      return {
        options,
        html: `
          <section class="atm-screen bank-screen">
            <div class="bank-header">
              <span class="bank-logo">Santander</span>
              <span class="bank-domain">www.santander.com.br</span>
            </div>
            <div class="bank-content">
              <h1 class="bank-title">Saldo disponível</h1>
              ${renderReceipt([
                ["Conta", "Corrente"],
                ["Cliente", account.holder],
                ["Saldo", formatCurrency(account.balance)]
              ])}
              <div class="message-actions bank-decision-actions">
                ${options.map(renderCornerButton).join("")}
              </div>
              ${renderTouchNote()}
            </div>
          </section>
        `
      };
    },
    statementPrinting() {
      return {
        options: [],
        html: `
          <section class="atm-screen bank-screen">
            <div class="bank-header">
              <span class="bank-logo">Santander</span>
              <span class="bank-domain">www.santander.com.br</span>
            </div>
            <div class="bank-content">
              <div class="message-layout">
                <div class="transaction-panel">
                  <div class="transaction-panel-side">Extrato de Conta Corrente</div>
                  <div class="transaction-panel-main">
                    <strong>Aguarde o final da impressão</strong>
                    <span>O extrato será liberado no compartimento abaixo.</span>
                  </div>
                </div>
                ${renderTouchNote()}
              </div>
            </div>
          </section>
        `
      };
    },
    statementReady() {
      return {
        options: [],
        html: `
          <section class="atm-screen bank-screen">
            <div class="bank-header">
              <span class="bank-logo">Santander</span>
              <span class="bank-domain">www.santander.com.br</span>
            </div>
            <div class="bank-content">
              <div class="message-layout">
                <div class="transaction-panel">
                  <div class="transaction-panel-side">Extrato de Conta Corrente</div>
                  <div class="transaction-panel-main">
                    <strong>Retire o demonstrativo</strong>
                    <span>Toque no slot de impresso para finalizar a retirada.</span>
                  </div>
                </div>
                ${renderTouchNote()}
              </div>
            </div>
          </section>
        `
      };
    },
    statementOffer() {
      const options = normalizeOptions([
        { slot: "l4", label: "Não", action: () => beginCardRemoval("endSession") },
        { slot: "r4", label: "Sim", action: () => goTo("amountMenu", { push: false }) }
      ]);

      return {
        options,
        html: `
          <section class="atm-screen bank-screen">
            <div class="bank-header">
              <span class="bank-logo">Santander</span>
              <span class="bank-domain">www.santander.com.br</span>
            </div>
            <div class="bank-content">
              <div class="message-layout bank-decision-layout">
                <div class="screen-message-box">
                  <p>Deseja realizar um saque?</p>
                </div>
                <div class="message-actions bank-decision-actions">
                  ${options.map(renderCornerButton).join("")}
                </div>
                ${renderTouchNote()}
              </div>
            </div>
          </section>
        `
      };
    },
    otherServices() {
      const options = normalizeOptions([
        { slot: "l4", label: "Encerrar", action: () => beginCardRemoval("endSession") },
        { slot: "r4", label: "Voltar", action: () => goTo("bankMenu", { push: false }) }
      ]);

      return {
        options,
        html: `
          <section class="atm-screen bank-screen">
            <div class="bank-header">
              <span class="bank-logo">Santander</span>
              <span class="bank-domain">www.santander.com.br</span>
            </div>
            <div class="bank-content">
              <div class="message-layout bank-decision-layout">
                <div class="screen-message-box">
                  <p>Outros Serviços</p>
                  <p>Bloqueio de celular, débito automático e autorização de pendências.</p>
                </div>
                <div class="message-actions bank-decision-actions">
                  ${options.map(renderCornerButton).join("")}
                </div>
                ${renderTouchNote()}
              </div>
            </div>
          </section>
        `
      };
    },
    notice() {
      const isBankScreen = state.cardInserted;
      const options = normalizeOptions([
        {
          slot: "r4",
          label: isBankScreen ? "Menu principal" : "Voltar ao início",
          action: () => goTo(isBankScreen ? "bankMenu" : "home", { push: false })
        }
      ]);

      if (isBankScreen) {
        return {
          options,
          html: `
            <section class="atm-screen bank-screen">
              <div class="bank-header">
                <span class="bank-logo">Santander</span>
                <span class="bank-domain">www.santander.com.br</span>
              </div>
              <div class="bank-content">
                <div class="message-layout bank-decision-layout">
                  <div class="screen-message-box">
                    <p>${state.noticeTitle}</p>
                    <p>${state.noticeMessage}</p>
                  </div>
                  <div class="message-actions bank-decision-actions">
                    <div></div>
                    ${options.map(renderCornerButton).join("")}
                  </div>
                  ${renderTouchNote()}
                </div>
              </div>
            </section>
          `
        };
      }

      return {
        options,
        html: `
          <section class="atm-screen">
            ${renderTopline()}
            <div class="screen-body">
              <div class="message-layout">
                <div class="screen-message-box">
                  <p>${state.noticeTitle}</p>
                  <p>${state.noticeMessage}</p>
                </div>
                <div class="message-actions">
                  <div></div>
                  ${options.map(renderCornerButton).join("")}
                </div>
                ${renderTouchNote()}
              </div>
            </div>
          </section>
        `
      };
    },
    withdrawCash() {
      return {
        options: [],
        html: `
          <section class="atm-screen bank-screen">
            <div class="bank-header">
              <span class="bank-logo">Santander</span>
              <span class="bank-domain">www.santander.com.br</span>
            </div>
            <div class="bank-content">
              <div class="message-layout">
                <div class="screen-message-box">
                  <p>Retire agora o seu dinheiro.</p>
                  <p>Use o compartimento abaixo da leitora de cartão.</p>
                </div>
                ${renderTouchNote()}
              </div>
            </div>
          </section>
        `
      };
    },
    withdrawAnother() {
      const options = normalizeOptions([
        { slot: "l4", label: "Não", action: () => beginCardRemoval("endSession") },
        { slot: "r4", label: "Sim", action: () => restartFromHome() }
      ]);

      return {
        options,
        html: `
          <section class="atm-screen bank-screen">
            <div class="bank-header">
              <span class="bank-logo">Santander</span>
              <span class="bank-domain">www.santander.com.br</span>
            </div>
            <div class="bank-content">
              <div class="message-layout bank-decision-layout">
                <div class="screen-message-box">
                  <p>Deseja realizar outra transação?</p>
                </div>
                <div class="message-actions bank-decision-actions">
                  ${options.map(renderCornerButton).join("")}
                </div>
                ${renderTouchNote()}
              </div>
            </div>
          </section>
        `
      };
    },
    thanks() {
      return {
        options: [],
        html: `
          <section class="atm-screen bank-screen">
            <div class="bank-header">
              <span class="bank-logo">Santander</span>
              <span class="bank-domain">www.santander.com.br</span>
            </div>
            <div class="bank-content">
              <div class="message-layout">
                <div class="screen-message-box brand-thanks-box">
                  <p>Obrigado por usar o Banco24Horas.</p>
                  <div class="thanks-brands">
                    <span class="thanks-brand santander">Santander</span>
                    <span class="thanks-brand b24">Banco24Horas</span>
                  </div>
                </div>
              </div>
            </div>
          </section>
        `
      };
    },
    removeCard() {
      return {
        options: [],
        html: `
          <section class="atm-screen bank-screen">
            <div class="bank-header">
              <span class="bank-logo">Santander</span>
              <span class="bank-domain">www.santander.com.br</span>
            </div>
            <div class="bank-content">
              <div class="message-layout bank-decision-layout">
                <div class="screen-message-box">
                  <p>Retire agora o seu cartão.</p>
                  <p>Toque no leitor de cartão abaixo para continuar o fluxo.</p>
                </div>
                <div class="remove-card-indicator" aria-hidden="true">
                  Retire o cartão no leitor abaixo
                </div>
                ${renderTouchNote()}
              </div>
            </div>
          </section>
        `
      };
    }
  };

  return screens[state.currentScreen]();
}

function bindScreenButtons() {
  clearHomeCarousel();

  const buttons = screenRoot.querySelectorAll("[data-option-id]");
  buttons.forEach((button) => {
    if (state.touchMode) {
      button.addEventListener("click", () => {
        activateOptionById(button.dataset.optionId);
      });
    }
  });

  const introStartButton = document.getElementById("introStartButton");
  if (introStartButton) {
    introStartButton.addEventListener("click", () => {
      if (isInteractionLocked()) {
        return;
      }

      openOnboarding();
    });
  }

}

function updateSideButtons() {
  sideButtons.forEach((button, index) => {
    const option = state.optionByIndex[index];
    button.classList.remove("is-active");
    button.disabled = state.touchMode || !option || isInteractionLocked();
    button.title = option
      ? option.label
      : "Sem opção atribuída";
  });
}

function updateScreenOptionAlignment() {
  const homeActions = screenRoot.querySelector(".home-actions");
  if (homeActions) {
    homeActions.style.transform = "translateY(0px)";
  }

  const optionButtons = Array.from(screenRoot.querySelectorAll("[data-option-id]"));
  optionButtons.forEach((button) => {
    button.style.top = "0px";
  });

  if (state.touchMode) {
    return;
  }

  if (state.currentScreen !== "home" || !homeActions || optionButtons.length === 0) {
    return;
  }

  const firstHomeOption = optionButtons[0];
  const firstOption = firstHomeOption
    ? state.optionById[firstHomeOption.dataset.optionId]
    : null;
  const firstOptionIndex = firstOption?.indices?.[0];
  const firstRightButton = Number.isInteger(firstOptionIndex)
    ? sideButtons[firstOptionIndex]
    : null;
  if (!firstHomeOption || !firstRightButton) {
    return;
  }

  const optionRect = firstHomeOption.getBoundingClientRect();
  const sideRect = firstRightButton.getBoundingClientRect();
  const optionCenter = optionRect.top + (optionRect.height / 2);
  const sideCenter = sideRect.top + (sideRect.height / 2);
  const offset = clampNumber(Math.round(sideCenter - optionCenter), 0, 64);

  homeActions.style.transform = `translateY(${offset}px)`;
}

function updateMachineStatus() {
  if (!state.termsAccepted) {
    cardStatus.textContent = "Leia o aviso inicial";
    return;
  }

  if (state.currentScreen === "readingCard") {
    cardStatus.textContent = "Lendo cartão";
    return;
  }

  if (state.hardwareAnimation === "card") {
    cardStatus.textContent = "Inserindo cartão";
    return;
  }

  if (state.hardwareAnimation === "pulse") {
    cardStatus.textContent = "Lendo palma";
    return;
  }

  if (state.hardwareAnimation === "finger") {
    cardStatus.textContent = "Lendo digital";
    return;
  }

  if (state.hardwareAnimation === "paper") {
    cardStatus.textContent = "Imprimindo extrato";
    return;
  }

  if (state.hardwareAnimation === "cash") {
    cardStatus.textContent = "Liberando dinheiro";
    return;
  }

  cardStatus.textContent = state.cardInserted
    ? state.currentScreen === "removeCard"
      ? "Retirar cartão"
      : "Cartão inserido"
    : "Inserir cartão";
}

function renderScreen() {
  clearHomeCarousel();
  const screen = getCurrentScreen();
  state.optionByIndex = Array(8).fill(null);
  state.optionById = {};

  screen.options.forEach((option) => {
    state.optionById[option.id] = option;
    option.indices.forEach((index) => {
      state.optionByIndex[index] = option;
    });
  });

  screenRoot.innerHTML = screen.html;
  bindScreenButtons();
  renderModal();
  updateSideButtons();
  updateDispenseSlots();
  updateMachineStatus();
  updateHelpSidebarButton();
  updateMachineScale();
  window.requestAnimationFrame(() => {
    updateScreenOptionAlignment();
    renderOnboarding();
    updateHelpSidebarButton();
  });
}

function activateOption(index) {
  const option = state.optionByIndex[index];

  if (!option || state.touchMode || isInteractionLocked()) {
    return;
  }

  const button = sideButtons[index];
  if (button) {
    button.classList.add("is-active");
    window.setTimeout(() => button.classList.remove("is-active"), 180);
  }

  option.action();
}

function activateOptionById(optionId) {
  const option = state.optionById[optionId];

  if (!option || isInteractionLocked()) {
    return;
  }

  option.action();
}

function insertCard() {
  if (state.cardInserted || !state.termsAccepted) {
    return;
  }

  clearDispensedItems();
  state.nextCardAction = null;
  state.hasCardPreference = true;
  state.cardInserted = true;
  state.cashDispensed = false;
  state.historyStack = [];
  goTo("readingCard", { push: false });
  scheduleScreen("bankMenu", CARD_READING_DELAY);
}

function recordHistory(label, amount) {
  account.history.unshift({
    label,
    value: formatCurrency(amount)
  });
  account.history = account.history.slice(0, 6);
}

function showNotice(title, message) {
  state.noticeTitle = title;
  state.noticeMessage = message;
  goTo("notice");
}

function startStatementFlow() {
  clearDispensedItems();
  state.nextCardAction = null;
  goTo("statementPrinting", { push: false });
  playHardwareAnimation("paper", () => {
    state.receiptDispensed = true;
    updateDispenseSlots();
    goTo("statementReady", { push: false });
  }, 1800);
}

function startWithdraw(amount) {
  if (account.balance < amount) {
    showNotice(
      "Saldo insuficiente",
      `Não foi possível sacar ${formatCurrency(amount)} porque o saldo disponível é ${formatCurrency(account.balance)}.`
    );
    return;
  }

  clearDispensedItems({ keepSelection: true });
  state.nextCardAction = null;
  state.selectedAmount = amount;
  goTo("processing", { push: false });
  state.pendingTimeout = window.setTimeout(() => {
    state.pendingTimeout = null;
    completeWithdraw();
  }, 1300);
}

function completeWithdraw() {
  const amount = state.selectedAmount || 0;
  account.balance -= amount;
  recordHistory(`Saque ${formatCurrency(amount)}`, -amount);
  beginCashDispense();
}

function beginCashDispense() {
  clearDispensedItems({ keepSelection: true });
  goTo("withdrawCash", { push: false });
  playHardwareAnimation("cash", () => {
    state.cashDispensed = true;
    updateDispenseSlots();
  }, 1800);
}

function takeCashFromSlot() {
  state.cashDispensed = false;
  updateDispenseSlots();
  goTo("withdrawAnother", { push: false });
}

function takeReceiptFromSlot() {
  state.receiptDispensed = false;
  updateDispenseSlots();
  goTo("statementOffer", { push: false });
}

function restartFromHome() {
  resetSessionArtifacts();
  state.cardInserted = true;
  state.nextCardAction = null;
  goTo("bankMenu", { push: false });
}

function showThanksThenHome() {
  resetSessionArtifacts();
  state.cardInserted = false;
  state.nextCardAction = null;
  goTo("thanks", { push: false });
  scheduleScreen("home", 1800);
}

function beginCardRemoval(nextAction = "endSession") {
  clearDispensedItems({ keepSelection: true });
  state.nextCardAction = nextAction;
  goTo("removeCard", { push: false });
}

function takeCardFromReader() {
  clearPendingTransition();

  if (!state.cardInserted) {
    return;
  }

  state.cardInserted = false;
  updateMachineStatus();

  if (state.nextCardAction === "dispenseCash") {
    state.nextCardAction = null;
    beginCashDispense();
    return;
  }

  state.nextCardAction = null;
  showThanksThenHome();
}

function startCardFlow() {
  state.hasCardPreference = true;
  state.noCardAccessValidated = false;
  state.noCardAccessRequested = false;
  state.termsAccepted = true;
  closeModal();
  updateMachineStatus();
  playHardwareAnimation("card", () => {
    insertCard();
  });
}

function acceptIntroWarning() {
  state.termsAccepted = true;
  closeModal();
  updateMachineStatus();
  updateHelpSidebarButton();
}

if (modalRoot) {
  modalRoot.addEventListener("click", (event) => {
    const introButton = event.target.closest("[data-intro-continue]");
    const choiceButton = event.target.closest("[data-card-choice]");
    const biometricButton = event.target.closest("[data-biometric-choice]");

    if (introButton) {
      acceptIntroWarning();
      return;
    }

    if (choiceButton) {
      if (choiceButton.dataset.cardChoice === "has-card") {
        startCardFlow();
        return;
      }

      openBiometricQuestionModal();
      return;
    }

    if (!biometricButton) {
      return;
    }

    if (biometricButton.dataset.biometricChoice === "continue") {
      closeModal();
      return;
    }
  });
}

if (onboardingRoot) {
  onboardingRoot.addEventListener("click", (event) => {
    const actionButton = event.target.closest("[data-onboarding-action]");
    if (!actionButton) {
      return;
    }

    if (actionButton.dataset.onboardingAction === "skip") {
      closeOnboarding();
      return;
    }

    if (actionButton.dataset.onboardingAction === "back") {
      goToPreviousOnboardingStep();
      return;
    }

    goToNextOnboardingStep();
  });
}

cardToggle.addEventListener("click", () => {
  if (isInteractionLocked()) {
    return;
  }

  if (!state.termsAccepted) {
    return;
  }

  if (state.currentScreen === "removeCard" && state.cardInserted) {
    takeCardFromReader();
    return;
  }

  if (state.cardInserted) {
    return;
  }

  startCardFlow();
});

if (receiptSlot) {
  receiptSlot.addEventListener("click", () => {
    if (!state.receiptDispensed || state.currentScreen !== "statementReady") {
      return;
    }

    takeReceiptFromSlot();
  });
}

if (cashSlot) {
  cashSlot.addEventListener("click", () => {
    if (!state.cashDispensed || state.currentScreen !== "withdrawCash") {
      return;
    }

    takeCashFromSlot();
  });
}

backButton.addEventListener("click", () => {
  if (isInteractionLocked()) {
    return;
  }

  clearPendingTransition();

  if (!state.termsAccepted) {
    goTo("intro", { push: false });
    return;
  }

  if (!state.cardInserted) {
    if (state.currentScreen !== "home") {
      goTo("home", { push: false });
    }
    return;
  }

  if (["amountMenu", "balance", "statementOffer", "otherServices", "notice"].includes(state.currentScreen)) {
    goTo("bankMenu", { push: false });
    return;
  }

  if (["statementPrinting", "statementReady"].includes(state.currentScreen)) {
    clearDispensedItems();
    goTo("bankMenu", { push: false });
    return;
  }

  if (["withdrawCash", "withdrawAnother"].includes(state.currentScreen)) {
    goTo("home", { push: false });
    return;
  }

  const previous = state.historyStack.pop();
  if (previous) {
    goTo(previous, { push: false });
  } else {
    goTo("bankMenu", { push: false });
  }
});

cancelButton.addEventListener("click", () => {
  if (isInteractionLocked()) {
    return;
  }

  clearPendingTransition();

  if (!state.termsAccepted) {
    goTo("intro", { push: false });
    return;
  }

  if (state.cardInserted) {
    beginCardRemoval("endSession");
  } else {
    goTo("home", { push: false });
  }
});

sideButtons.forEach((button) => {
  button.addEventListener("click", () => {
    activateOption(Number(button.dataset.index));
  });
});

if (helpSidebarButton) {
  helpSidebarButton.addEventListener("click", () => {
    if (isInteractionLocked() || state.currentScreen !== "home") {
      return;
    }

    openOnboarding();
  });
}

if (fingerprintReader) {
  fingerprintReader.addEventListener("click", (event) => {
    const clickedElement = event.target instanceof Element ? event.target : null;
    const device = fingerprintReader.querySelector(".fingerprint-device");
    const clickedInsideDevice = clickedElement?.closest(".fingerprint-device");

    if (!device || !clickedInsideDevice) {
      return;
    }

    const forcePulse = clickedElement?.closest(".fingerprint-pulse-base, .fingerprint-arm, .fingerprint-pad");
    const forceFinger = clickedElement?.closest(".fingerprint-head, .fingerprint-sensor-ring, .fingerprint-red-visor");

    let biometricType = "finger";
    if (forcePulse) {
      biometricType = "pulse";
    } else if (forceFinger) {
      biometricType = "finger";
    } else {
      const deviceRect = device.getBoundingClientRect();
      const relativeY = event.clientY - deviceRect.top;
      biometricType = relativeY >= deviceRect.height * 0.56 ? "pulse" : "finger";
    }

    startBiometricHardwareFlow(biometricType);
  });
}

if (reloadPageHotspot) {
  reloadPageHotspot.addEventListener("click", () => {
    window.location.reload();
  });
}

window.addEventListener("resize", setTouchMode);

window.addEventListener("load", () => {
  updateMachineScale();
  updateScreenOptionAlignment();
  renderOnboarding();
});

if (document.fonts && document.fonts.ready) {
  document.fonts.ready.then(() => {
    updateMachineScale();
    updateScreenOptionAlignment();
    renderOnboarding();
  });
}

setTouchMode();
renderScreen();
