// ============================================================================
// SAMARITAN SHIELD — Triage Tree (Finite State Machine)
// 4-Step Severe Trauma Algorithm
// Bleeding → Breathing → CPR (Compressions Only)
//
// Clinical rationale:
//   - Exsanguination kills in <3 minutes
//   - Brain survives 4–6 minutes without O₂
//   - Therefore: STOP THE BLEED before you check breathing
// ============================================================================

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------
export type TriageAction =
  | 'start_cpr'
  | 'control_bleeding'
  | 'recovery_position'
  | 'monitor'
  | 'auto_advance';

export interface TriageNode {
  /** Unique node identifier */
  id: string;
  /** The text to be spoken aloud via TTS */
  text: string;
  /** Node ID to transition to if user says YES */
  onYes?: string;
  /** Node ID to transition to if user says NO */
  onNo?: string;
  /** Action to trigger when this node is reached */
  action?: TriageAction;
  /** If true, this node has no further yes/no branching */
  isTerminal: boolean;
  /** Emoji icon for visual display */
  icon: string;
  /** Short label for the status bar */
  label: string;
  /** Step number in the 4-step protocol (for display) */
  step?: number;
  /** Auto-advance target after TTS completes (for instruction-only nodes) */
  autoAdvanceTo?: string;
  /** Delay in ms before auto-advancing (default 3000) */
  autoAdvanceDelayMs?: number;
  /** Optional local image source for an instructional image (e.g. CPR diagram) */
  imageSource?: any;
}

export interface TriageTreeMap {
  [nodeId: string]: TriageNode;
}

// ---------------------------------------------------------------------------
// The State Machine — 4-Step Severe Trauma Algorithm
// ---------------------------------------------------------------------------
export const INITIAL_NODE_ID = 'scene_safety';

export const TriageTree: TriageTreeMap = {
  // =========================================================================
  // STEP 1: SECURE & ASSESS — Danger + Response
  // =========================================================================
  scene_safety: {
    id: 'scene_safety',
    text: 'Step 1. Secure the scene. Look around. Are you safe to approach? No oncoming traffic, fire, or active danger to you?',
    onYes: 'check_response',
    onNo: 'scene_not_safe',
    isTerminal: false,
    icon: '⚠️',
    label: 'SCENE SAFETY',
    step: 1,
  },

  scene_not_safe: {
    id: 'scene_not_safe',
    text: 'Stop. Do not approach. Your safety comes first. Move to a safe distance and wait for emergency services. Do not become a second victim.',
    isTerminal: true,
    icon: '🚫',
    label: 'SCENE UNSAFE — STAND BACK',
    step: 1,
    action: 'monitor',
  },

  check_response: {
    id: 'check_response',
    text: 'Approach the victim. Shout loudly: Can you hear me? Tap their collarbone hard. Do they respond or moan?',
    onYes: 'victim_responsive',
    onNo: 'call_108',
    isTerminal: false,
    icon: '🗣️',
    label: 'CHECK RESPONSE',
    step: 1,
  },

  victim_responsive: {
    id: 'victim_responsive',
    text: 'They are responsive. That means they are breathing and have a pulse. Do not move their neck. Keep them completely still. Now scan for massive bleeding.',
    isTerminal: false,
    icon: '✅',
    label: 'VICTIM RESPONSIVE',
    step: 1,
    action: 'auto_advance',
    autoAdvanceTo: 'check_massive_bleeding',
    autoAdvanceDelayMs: 4000,
  },

  call_108: {
    id: 'call_108',
    text: 'They are unconscious. Point at a specific bystander now and yell: You, call 108 and tell them we have an unconscious trauma victim! Moving to bleeding check.',
    isTerminal: false,
    icon: '📞',
    label: 'CALL 108 — BYSTANDER ALERT',
    step: 1,
    action: 'auto_advance',
    autoAdvanceTo: 'check_massive_bleeding',
    autoAdvanceDelayMs: 4000,
  },

  // =========================================================================
  // STEP 2: CHECK FOR MASSIVE WOUNDS — Leading cause of preventable death
  // =========================================================================
  check_massive_bleeding: {
    id: 'check_massive_bleeding',
    text: 'Step 2. Check for massive bleeding now. Do a rapid visual and physical sweep of their body. Is there blood spurting like a pump, or a rapidly expanding pool of blood on the ground?',
    onYes: 'control_bleeding',
    onNo: 'check_breathing',
    isTerminal: false,
    icon: '🩸',
    label: 'CHECK MASSIVE BLEEDING',
    step: 2,
  },

  control_bleeding: {
    id: 'control_bleeding',
    text: 'Massive bleeding found. Ignore everything else. Rip their clothes to expose the wound. Stuff a shirt or gauze deep into the wound cavity. Lock your elbows and put your entire body weight on it. If it is on an arm or leg, tie a tourniquet 2 inches above the wound and twist until bleeding stops completely. Has the bleeding stopped?',
    onYes: 'check_breathing',
    onNo: 'control_bleeding_persist',
    isTerminal: false,
    icon: '🩹',
    label: 'CONTROL BLEEDING',
    step: 2,
    action: 'control_bleeding',
    imageSource: require('./assets/direct_pressure.jpg'),
  },

  control_bleeding_persist: {
    id: 'control_bleeding_persist',
    text: 'The bleeding has not stopped. Do NOT move to the next step. Maintain maximum pressure. Repack the wound deeper. Tighten the tourniquet further. You must stop the bleeding before anything else. Has the bleeding stopped now?',
    onYes: 'check_breathing',
    onNo: 'control_bleeding_persist',
    isTerminal: false,
    icon: '🩹',
    label: 'BLEEDING NOT CONTROLLED — KEEP PRESSURE',
    step: 2,
    action: 'control_bleeding',
  },

  // =========================================================================
  // STEP 3: CHECK BREATHING — Only after bleeding is controlled
  // =========================================================================
  check_breathing: {
    id: 'check_breathing',
    text: 'Step 3. Check breathing now. Look at their bare chest. Is it rising and falling steadily? Put your ear next to their mouth. Can you hear air moving? Remember: occasional loud gasping means their heart has stopped. That is not normal breathing. Is the victim breathing normally?',
    onYes: 'recovery_position',
    onNo: 'cpr_prep',
    isTerminal: false,
    icon: '🫁',
    label: 'CHECK BREATHING',
    step: 3,
  },

  recovery_position: {
    id: 'recovery_position',
    text: 'They are breathing. Good. Roll them onto their side into the recovery position now. Step 1: Keep the groundward leg straight and aligned with their back. Step 2: Bend their skyward leg at the knee so the knee touches the ground for stability. Step 3: Bend their skyward arm upward and tuck their hand under their cheek to cushion the face. Step 4: Angle their face and head toward the ground so fluids drain out of the mouth, not into the airway. Monitor their breathing continuously and do not leave them on their back. Wait for paramedics.',
    isTerminal: true,
    icon: '🛏️',
    label: 'RECOVERY POSITION — MONITOR',
    step: 3,
    action: 'recovery_position',
    imageSource: require('./assets/recovery_position.jpg'),
  },

  // =========================================================================
  // STEP 4: EXECUTE CPR — Chest compressions ONLY. No mouth-to-mouth.
  // =========================================================================
  cpr_prep: {
    id: 'cpr_prep',
    text: 'They are not breathing. Their heart has stopped. You must become their physical heart. Place the heel of one hand directly in the center of their chest, between the nipples. Place your other hand on top and interlock your fingers. Lock your elbows completely straight. Are you in position?',
    onYes: 'start_cpr',
    onNo: 'cpr_prep',
    isTerminal: false,
    icon: '⚡',
    label: 'CPR PREPARATION',
    step: 4,
    imageSource: require('./assets/cpr_chest_compressions.jpg'),
  },

  start_cpr: {
    id: 'start_cpr',
    text: 'Starting CPR metronome now! Push down hard, at least 2 inches deep, and fast. Follow the beat. Do not stop. Let the chest recoil completely after each push. You will likely break their ribs. Ignore the cracking sound and keep pushing until paramedics physically take over or the person wakes up.',
    action: 'start_cpr',
    isTerminal: true,
    icon: '❤️',
    label: 'CPR IN PROGRESS — COMPRESSIONS ONLY',
    step: 4,
  },
};
