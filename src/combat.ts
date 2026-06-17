import type { V2MatchState } from "./matchState.js";
import { BUILDING_CATALOG } from "./catalog.js";
import { type OwnerId, BEAM_MATERIALS } from "./mapTypes.js";

export interface WeaponGroup {
    readonly weaponIds: string[];
}

export interface ProjectilePathPoint {
    readonly x: number;
    readonly y: number;
}

export interface FiringResult {
    readonly shooterId: string;
    readonly targetX: number;
    readonly targetY: number;
    readonly damageDealt: number;
    readonly hitBuildingId?: string;
    readonly hitBeamId?: string;
    readonly path: ProjectilePathPoint[];
}

/** Расчет сектора огня (конус).
 * Для простоты: пушки игрока 0 стреляют вверх, игрока 1 - вниз.
 * Сектор задается углом от вертикали.
 */
export function isWithinFiringCone(
    shooterX: number, shooterY: number,
    targetX: number, targetY: number,
    owner: OwnerId,
    coneHalfAngleDeg: number = 60
): boolean {
    const dx = targetX - shooterX;
    const dy = targetY - shooterY;

    // Вектор направления (1, 0) для P0 (стреляет вправо) и (-1, 0) для P1 (стреляет влево)
    const dirX = owner === 0 ? 1 : -1;

    const angleRad = Math.atan2(Math.abs(dy), dx * dirX);
    const angleDeg = (angleRad * 180) / Math.PI;

    return angleDeg <= coneHalfAngleDeg;
}

/** Логика выстрела */
export function fireWeapon(
    state: V2MatchState,
    weaponId: string,
    targetX: number,
    targetY: number
): { nextState: V2MatchState; result?: FiringResult } {
    const weapon = state.buildings.get(weaponId);
    if (!weapon || !weapon.isOperational) return { nextState: state };

    const shooterNode = state.nodes.get(weapon.nodeIds[0]!)!;
    const path: ProjectilePathPoint[] = [];
    const steps = 20;

    // Генерируем параболическую траекторию
    for (let i = 0; i <= steps; i++) {
        const t = i / steps;
        const x = shooterNode.x + (targetX - shooterNode.x) * t;
        const peakHeight = 2;
        const y = shooterNode.y + (targetY - shooterNode.y) * t - peakHeight * Math.sin(Math.PI * t);
        path.push({ x, y });
    }

    const def = BUILDING_CATALOG[weapon.defId];
    if (def.kind !== "weapon") return { nextState: state };

    const eco = state.economy[weapon.owner];
    const ammoNeeded = def.ammoPerShot ?? 1;

    if ((eco.resources.ammo ?? 0) < ammoNeeded) {
        return { nextState: state }; // Недостаточно патронов
    }

    // Тратим боезапас
    const nextEco = {
        ...eco,
        resources: { ...eco.resources, ammo: eco.resources.ammo! - ammoNeeded }
    };
    const nextEconomies = [...state.economy] as [any, any];
    nextEconomies[weapon.owner] = nextEco;

    let nextState = { ...state, economy: nextEconomies };

    // Проверяем попадание (упрощенно по координатам)
    let hitBuildingId: string | undefined;
    let hitBeamId: string | undefined;
    let finalDamage = def.damage ?? 0;
    const damageType = def.damageType ?? "kinetic";

    // Module effects
    if (weapon.modules.includes("overcharge_coil")) {
        finalDamage *= 1.5;
    }

    const buildings = new Map(nextState.buildings);
    for (const [bid, b] of buildings) {
        if (b.owner !== weapon.owner) {
            const node = nextState.nodes.get(b.nodeIds[0]!);
            if (node && Math.round(node.x) === targetX && Math.round(node.y) === targetY) {
                hitBuildingId = bid;

                if (damageType === "emp") {
                    // EMP disables operational status instead of dealing heavy HP damage
                    buildings.set(bid, { ...b, isOperational: false, hp: b.hp - 10 });
                } else {
                    const nextHp = b.hp - finalDamage;
                    let fireLevel = b.fireLevel;
                    if (damageType === "fire") fireLevel = Math.min(100, fireLevel + 50);

                    if (nextHp <= 0) buildings.delete(bid);
                    else buildings.set(bid, { ...b, hp: nextHp, fireLevel });
                }
                break;
            }
        }
    }

    nextState = { ...nextState, buildings };

    if (!hitBuildingId) {
        const beams = new Map(nextState.beams);
        for (const [bid, beam] of beams) {
            if (beam.owner !== weapon.owner) {
                const nodeA = nextState.nodes.get(beam.nodeAId)!;
                const nodeB = nextState.nodes.get(beam.nodeBId)!;
                if (isPointNearBeam(targetX, targetY, nodeA, nodeB)) {
                    hitBeamId = bid;
                    const mat = BEAM_MATERIALS[beam.materialId];
                    const multiplier = mat.resistances[damageType] ?? 1.0;
                    let dmg = finalDamage * multiplier;

                    if (damageType === "emp") dmg = 5; // Minimal structural damage for EMP

                    const nextHp = beam.hp - dmg;
                    let fireLevel = beam.fireLevel;
                    if (damageType === "fire") fireLevel = Math.min(100, fireLevel + (50 * mat.flammability));

                    if (nextHp <= 0) beams.delete(bid);
                    else beams.set(bid, { ...beam, hp: nextHp, fireLevel });
                    break;
                }
            }
        }
        nextState = { ...nextState, beams };
    }

    return {
        nextState,
        result: {
            shooterId: weaponId,
            targetX,
            targetY,
            damageDealt: finalDamage,
            hitBuildingId,
            hitBeamId,
            path,
        }
    };
}

function isPointNearBeam(px: number, py: number, a: {x:number, y:number}, b: {x:number, y:number}): boolean {
    const threshold = 0.5;
    const l2 = (a.x - b.x)**2 + (a.y - b.y)**2;
    if (l2 === 0) return Math.sqrt((px - a.x)**2 + (py - a.y)**2) < threshold;
    let t = ((px - a.x) * (b.x - a.x) + (py - a.y) * (b.y - a.y)) / l2;
    t = Math.max(0, Math.min(1, t));
    const dist = Math.sqrt((px - (a.x + t * (b.x - a.x)))**2 + (py - (a.y + t * (b.y - a.y)))**2);
    return dist < threshold;
}
