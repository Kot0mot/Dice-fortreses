using System.Collections.Generic;

namespace DiceFortresses.Core {
    public enum BuildingKind { CoreGenerator, Generator, TechStation, Weapon, Storage, RepairStation }

    public class BuildingDef {
        public string Id;
        public string Name;
        public BuildingKind Kind;
        public float MaxHp;
        public float Weight;
        public Dictionary<string, int> Cost;
        public float Damage;
        public DamageType DamageType;
        public float AmmoPerShot;
        public string TechRequired;
        public float PowerRequired;
        public int WorkersRequired;
    }

    public static class Catalog {
        public static readonly Dictionary<string, BuildingDef> Buildings = new Dictionary<string, BuildingDef> {
            ["core_generator"] = new BuildingDef { Id = "core_generator", Name = "Core", Kind = BuildingKind.CoreGenerator, MaxHp = 1000, Weight = 50 },
            ["machine_gun"] = new BuildingDef { Id = "machine_gun", Name = "Machine Gun", Kind = BuildingKind.Weapon, MaxHp = 100, Weight = 15, Damage = 10, DamageType = DamageType.Kinetic, AmmoPerShot = 1 },
            ["laser_turret"] = new BuildingDef { Id = "laser_turret", Name = "Laser", Kind = BuildingKind.Weapon, MaxHp = 120, Weight = 30, Damage = 40, DamageType = DamageType.Energy, TechRequired = "tech_station", PowerRequired = 10 },
            ["railgun"] = new BuildingDef { Id = "railgun", Name = "Railgun", Kind = BuildingKind.Weapon, MaxHp = 300, Weight = 80, Damage = 150, DamageType = DamageType.Kinetic, TechRequired = "tech_station", PowerRequired = 50, WorkersRequired = 4 }
        };

        public static readonly Dictionary<BeamMaterialId, BeamMaterial> Materials = new Dictionary<BeamMaterialId, BeamMaterial> {
            [BeamMaterialId.Wood] = new BeamMaterial { Id = BeamMaterialId.Wood, Name = "Wood", MaxHp = 50, Weight = 1, Capacity = 100, Flammability = 0.8f, Resistances = new Dictionary<DamageType, float> { [DamageType.Fire] = 2.0f, [DamageType.Kinetic] = 1.0f, [DamageType.Energy] = 2.0f, [DamageType.Blast] = 1.5f, [DamageType.Emp] = 0f } },
            [BeamMaterialId.Metal] = new BeamMaterial { Id = BeamMaterialId.Metal, Name = "Metal", MaxHp = 150, Weight = 3, Capacity = 400, IsConductive = true, Resistances = new Dictionary<DamageType, float> { [DamageType.Fire] = 0.5f, [DamageType.Kinetic] = 1.0f, [DamageType.Energy] = 1.0f, [DamageType.Blast] = 1.0f, [DamageType.Emp] = 0.1f } }
        };
    }
}
