using System;
using System.Collections.Generic;

namespace DiceFortresses.Core {
    public enum OwnerId { Player0 = 0, Player1 = 1 }
    public enum DamageType { Kinetic, Energy, Blast, Fire, Emp }
    public enum BeamMaterialId { Wood, Metal, ArmorPlating, EnergyShield, CarbonFiber, ReinforcedConcrete }

    public class BeamMaterial {
        public BeamMaterialId Id;
        public string Name;
        public float MaxHp;
        public float Weight;
        public float Capacity;
        public Dictionary<DamageType, float> Resistances;
        public float Flammability;
        public bool IsConductive;
    }

    public static class Constants {
        public const int GridWidth = 40;
        public const int GridHeight = 20;
        public const float CellSize = 40f;
    }

    public class V2Node {
        public string Id;
        public float X, Y;
        public OwnerId Owner;
        public bool IsGround;
    }

    public class V2Beam {
        public string Id;
        public string NodeAId;
        public string NodeBId;
        public BeamMaterialId MaterialId;
        public float Hp;
        public OwnerId Owner;
        public float FireLevel;
        public bool IsPowered;
    }

    public class BuildingInstance {
        public string Id;
        public string DefId;
        public OwnerId Owner;
        public List<string> NodeIds;
        public float Hp;
        public bool IsOperational;
        public int Level;
        public float FireLevel;
        public bool IsPowered;
        public List<string> Modules = new List<string>();
    }
}
