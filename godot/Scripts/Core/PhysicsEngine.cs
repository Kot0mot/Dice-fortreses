using System;
using System.Collections.Generic;
using System.Linq;

namespace DiceFortresses.Core {
    public class StructuralState {
        public Dictionary<string, V2Node> Nodes;
        public Dictionary<string, V2Beam> Beams;
        public Dictionary<string, BuildingInstance> Buildings;
    }

    public static class PhysicsEngine {
        public static void UpdatePowerGrid(StructuralState state) {
            var poweredNodes = new HashSet<string>();
            var queue = new Queue<string>();

            foreach (var b in state.Buildings.Values) {
                var def = Catalog.Buildings[b.DefId];
                if ((def.Kind == BuildingKind.CoreGenerator || def.Kind == BuildingKind.Generator) && b.IsOperational) {
                    foreach (var nid in b.NodeIds) {
                        if (poweredNodes.Add(nid)) queue.Enqueue(nid);
                    }
                }
            }

            while (queue.Count > 0) {
                var nodeId = queue.Dequeue();
                foreach (var beam in state.Beams.Values) {
                    var mat = Catalog.Materials[beam.MaterialId];
                    if (!mat.IsConductive && beam.MaterialId != BeamMaterialId.EnergyShield) continue;

                    if (beam.NodeAId == nodeId && poweredNodes.Add(beam.NodeBId)) queue.Enqueue(beam.NodeBId);
                    else if (beam.NodeBId == nodeId && poweredNodes.Add(beam.NodeAId)) queue.Enqueue(beam.NodeAId);
                }
            }

            foreach (var beam in state.Beams.Values) {
                beam.IsPowered = poweredNodes.Contains(beam.NodeAId) && poweredNodes.Contains(beam.NodeBId);
            }

            foreach (var b in state.Buildings.Values) {
                b.IsPowered = b.NodeIds.All(nid => poweredNodes.Contains(nid));
            }
        }

        public static Dictionary<string, float> CalculateLoads(StructuralState state) {
            var beamLoads = new Dictionary<string, float>();
            var nodeWeights = new Dictionary<string, float>();

            foreach (var b in state.Buildings.Values) {
                var def = Catalog.Buildings[b.DefId];
                float weightPerNode = def.Weight / b.NodeIds.Count;
                foreach (var nid in b.NodeIds) {
                    nodeWeights[nid] = nodeWeights.GetValueOrDefault(nid, 0) + weightPerNode;
                }
            }

            foreach (var beam in state.Beams.Values) {
                var mat = Catalog.Materials[beam.MaterialId];
                float weightPerNode = mat.Weight / 2f;
                nodeWeights[beam.NodeAId] = nodeWeights.GetValueOrDefault(beam.NodeAId, 0) + weightPerNode;
                nodeWeights[beam.NodeBId] = nodeWeights.GetValueOrDefault(beam.NodeBId, 0) + weightPerNode;
            }

            var sortedNodes = state.Nodes.Values.OrderBy(n => n.Y).ToList();
            var accumulatedWeight = new Dictionary<string, float>(nodeWeights);

            foreach (var node in sortedNodes) {
                if (node.IsGround) continue;
                float weightToDistribute = accumulatedWeight.GetValueOrDefault(node.Id, 0);

                var downwardBeams = state.Beams.Values.Where(b =>
                    (b.NodeAId == node.Id && state.Nodes[b.NodeBId].Y > node.Y) ||
                    (b.NodeBId == node.Id && state.Nodes[b.NodeAId].Y > node.Y)
                ).ToList();

                if (downwardBeams.Count > 0) {
                    float share = weightToDistribute / downwardBeams.Count;
                    foreach (var beam in downwardBeams) {
                        beamLoads[beam.Id] = beamLoads.GetValueOrDefault(beam.Id, 0) + share;
                        string otherNodeId = beam.NodeAId == node.Id ? beam.NodeBId : beam.NodeAId;
                        accumulatedWeight[otherNodeId] = accumulatedWeight.GetValueOrDefault(otherNodeId, 0) + share;
                    }
                }
            }

            return beamLoads;
        }

        public static void PerformCollapse(StructuralState state) {
            var loads = CalculateLoads(state);
            var toDelete = new List<string>();

            foreach (var beam in state.Beams.Values) {
                float load = loads.GetValueOrDefault(beam.Id, 0);
                var mat = Catalog.Materials[beam.MaterialId];
                if (load > mat.Capacity) toDelete.Add(beam.Id);
            }

            foreach (var id in toDelete) state.Beams.Remove(id);
        }
    }
}
