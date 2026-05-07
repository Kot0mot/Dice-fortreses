/**
 * Числовые якоря MVP «Dice Fortresses» (см. doc/dice-forts-hybrid-gdd.md).
 */

/** Количество кубов за раунд на игрока. */
export const DICE_FORTS_DICE_COUNT = 4;

export const DICE_FORTS_DICE_MIN = 1;
export const DICE_FORTS_DICE_MAX = 6;

/** Один общий reroll на игрока за раунд (мета может увеличить). */
export const DICE_FORTS_REROLLS_PER_ROUND = 1;

export const DICE_FORTS_CORE_HP = 20;

export const DICE_FORTS_BLOCK_HP = 4;

/** Лимит прироста/ремонта HP одной клетки за раунд (Build). */
export const DICE_FORTS_MAX_REPAIR_PER_CELL_PER_ROUND = 3;

/** Минимальный max в слоте Arm для выстрела. */
export const DICE_FORTS_ARM_THRESHOLD = 4;

/** Урон = max(1, maxArm - DICE_FORTS_ARM_DAMAGE_OFFSET). */
export const DICE_FORTS_ARM_DAMAGE_OFFSET = 3;

/** При max === 6 снаряд пробивает две клетки по колонке. */
export const DICE_FORTS_ARM_PIERCE_DEPTH_ON_MAX = 2;

/** Размер сетки крепости в GDD (ширина × высота). */
export const DICE_FORTS_GRID_WIDTH = 12;
export const DICE_FORTS_GRID_HEIGHT = 8;
