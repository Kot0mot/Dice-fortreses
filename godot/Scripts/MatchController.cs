using Godot;
using DiceFortresses.Core;
using System.Collections.Generic;

public partial class MatchController : Node2D {
    public StructuralState CurrentState = new StructuralState {
        Nodes = new Dictionary<string, V2Node>(),
        Beams = new Dictionary<string, V2Beam>(),
        Buildings = new Dictionary<string, BuildingInstance>()
    };

    public override void _Ready() {
        GD.Print("Dice Fortresses Godot Engine Started");
        InitializeGround();
    }

    private void InitializeGround() {
        for (int x = 0; x < 10; x++) {
            var id = $"ground-{x}";
            CurrentState.Nodes[id] = new V2Node { Id = id, X = x, Y = DiceFortresses.Core.Constants.GridHeight - 1, IsGround = true };
        }
    }

    public override void _Process(double delta) {
        QueueRedraw();
    }

    public override void _Draw() {
        foreach (var beam in CurrentState.Beams.Values) {
            var nodeA = CurrentState.Nodes[beam.NodeAId];
            var nodeB = CurrentState.Nodes[beam.NodeBId];

            Color beamColor = beam.MaterialId switch {
                BeamMaterialId.Wood => new Color(0.5f, 0.3f, 0.1f),
                BeamMaterialId.Metal => new Color(0.7f, 0.7f, 0.8f),
                _ => Colors.White
            };

            DrawLine(
                new Vector2(nodeA.X * DiceFortresses.Core.Constants.CellSize, nodeA.Y * DiceFortresses.Core.Constants.CellSize),
                new Vector2(nodeB.X * DiceFortresses.Core.Constants.CellSize, nodeB.Y * DiceFortresses.Core.Constants.CellSize),
                beamColor,
                4.0f
            );
        }

        foreach (var node in CurrentState.Nodes.Values) {
            DrawCircle(
                new Vector2(node.X * DiceFortresses.Core.Constants.CellSize, node.Y * DiceFortresses.Core.Constants.CellSize),
                4.0f,
                node.IsGround ? Colors.Gray : (node.Owner == OwnerId.Player0 ? Colors.Green : Colors.Red)
            );
        }
    }
}
