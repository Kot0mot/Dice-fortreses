using System;
using System.Collections.Generic;
using Godot;

namespace DiceFortresses.Core {
    public class FiringResult {
        public string ShooterId;
        public Vector2 Target;
        public float DamageDealt;
        public string HitBuildingId;
        public string HitBeamId;
        public List<Vector2> Path;
    }

    public static class CombatSystem {
        public static bool IsWithinFiringCone(Vector2 shooter, Vector2 target, OwnerId owner, float halfAngleDeg = 60f) {
            Vector2 diff = target - shooter;
            float dirX = owner == OwnerId.Player0 ? 1f : -1f;
            float angleRad = Mathf.Atan2(Mathf.Abs(diff.Y), diff.X * dirX);
            return Mathf.RadToDeg(angleRad) <= halfAngleDeg;
        }

        public static FiringResult FireWeapon(StructuralState state, string weaponId, Vector2 target) {
            if (!state.Buildings.TryGetValue(weaponId, out var weapon) || !weapon.IsOperational) return null;

            var def = Catalog.Buildings[weapon.DefId];
            var shooterNode = state.Nodes[weapon.NodeIds[0]];
            var shooterPos = new Vector2(shooterNode.X, shooterNode.Y);

            var result = new FiringResult {
                ShooterId = weaponId,
                Target = target,
                DamageDealt = def.Damage,
                Path = GenerateParabolicPath(shooterPos, target)
            };

            // Simplified hit detection logic for Godot C# port
            foreach (var b in state.Buildings.Values) {
                if (b.Owner != weapon.Owner) {
                    var node = state.Nodes[b.NodeIds[0]];
                    if (new Vector2(node.X, node.Y).DistanceTo(target) < 0.5f) {
                        result.HitBuildingId = b.Id;
                        b.Hp -= result.DamageDealt;
                        return result;
                    }
                }
            }

            return result;
        }

        private static List<Vector2> GenerateParabolicPath(Vector2 start, Vector2 end) {
            var path = new List<Vector2>();
            int steps = 20;
            for (int i = 0; i <= steps; i++) {
                float t = i / (float)steps;
                float x = Mathf.Lerp(start.X, end.X, t);
                float peak = 2.0f;
                float y = Mathf.Lerp(start.Y, end.Y, t) - peak * Mathf.Sin(Mathf.Pi * t);
                path.Add(new Vector2(x, y));
            }
            return path;
        }
    }
}
