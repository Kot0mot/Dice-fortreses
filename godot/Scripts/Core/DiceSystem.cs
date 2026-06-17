using System;
using System.Collections.Generic;

namespace DiceFortresses.Core {
    public class DiceFaceEffect {
        public string ResourceId;
        public float Amount;
        public string EffectId;
    }

    public class CustomDie {
        public string Id;
        public List<DiceFaceEffect> Faces;
    }

    public static class DiceSystem {
        public static DiceFaceEffect Roll(CustomDie die, Random rng) {
            int idx = rng.Next(0, 6);
            return die.Faces[idx];
        }

        public static List<CustomDie> GetPlayerDice(StructuralState state, OwnerId player) {
            var dice = new List<CustomDie>();
            foreach (var b in state.Buildings.Values) {
                if (b.Owner == player && b.IsOperational) {
                    // Logic to get dice definitions from catalog...
                }
            }
            return dice;
        }
    }
}
