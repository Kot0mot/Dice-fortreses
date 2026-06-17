using Godot;
using DiceFortresses.Core;
using System.Collections.Generic;

public partial class MatchController : Node2D {
    public StructuralState CurrentState = new StructuralState {
        Nodes = new Dictionary<string, V2Node>(),
        Beams = new Dictionary<string, V2Beam>(),
        Buildings = new Dictionary<string, BuildingInstance>()
    };

    private string _selectedNodeId = null;
    private BeamMaterialId _selectedMaterial = BeamMaterialId.Wood;
    private int _steel = 100;

    private Label _infoLabel;

    public override void _Ready() {
        _infoLabel = GetNode<Label>("UI/Label");
        GD.Print("Dice Fortresses Godot Engine Started (Debug Mode)");
        InitializeGround();
    }

    private void InitializeGround() {
        for (int x = 0; x < 20; x++) {
            var id = $"ground-{x}";
            CurrentState.Nodes[id] = new V2Node {
                Id = id, X = x + 10, Y = DiceFortresses.Core.Constants.GridHeight - 1,
                IsGround = true, Owner = OwnerId.Player0
            };
        }
    }

    public override void _Input(InputEvent @event) {
        if (@event is InputEventMouseButton mouseEvent && mouseEvent.Pressed && mouseEvent.ButtonIndex == MouseButton.Left) {
            HandleClick(mouseEvent.Position);
        }
    }

    private void HandleClick(Vector2 screenPos) {
        float cellSize = DiceFortresses.Core.Constants.CellSize;
        int gridX = Mathf.RoundToInt(screenPos.X / cellSize);
        int gridY = Mathf.RoundToInt(screenPos.Y / cellSize);
        string clickedId = null;

        // Find if we clicked an existing node
        foreach (var node in CurrentState.Nodes.Values) {
            if (Mathf.Abs(node.X - gridX) < 0.2f && Mathf.Abs(node.Y - gridY) < 0.2f) {
                clickedId = node.Id;
                break;
            }
        }

        if (clickedId != null) {
            if (_selectedNodeId == null) {
                _selectedNodeId = clickedId;
                GD.Print($"Selected Node: {clickedId}");
            } else if (_selectedNodeId != clickedId) {
                TryBuildBeam(_selectedNodeId, clickedId);
                _selectedNodeId = null;
            }
        } else {
            // Clicked empty space: Create node if connected
            if (_selectedNodeId != null) {
                string newNodeId = $"node-{gridX}-{gridY}";
                CurrentState.Nodes[newNodeId] = new V2Node { Id = newNodeId, X = gridX, Y = gridY, Owner = OwnerId.Player0, IsGround = false };
                TryBuildBeam(_selectedNodeId, newNodeId);
                _selectedNodeId = null;
            }
        }
    }

    private void TryBuildBeam(string a, string b) {
        string beamId = $"beam-{a}-{b}";
        if (CurrentState.Beams.ContainsKey(beamId)) return;

        CurrentState.Beams[beamId] = new V2Beam {
            Id = beamId, NodeAId = a, NodeBId = b, MaterialId = _selectedMaterial,
            Hp = DiceFortresses.Core.Catalog.Materials[_selectedMaterial].MaxHp,
            Owner = OwnerId.Player0, FireLevel = 0, IsPowered = false
        };

        // Run Physics
        DiceFortresses.Core.PhysicsEngine.UpdatePowerGrid(CurrentState);
        DiceFortresses.Core.PhysicsEngine.PerformCollapse(CurrentState);
        GD.Print("Physics Updated!");
    }

    public override void _Process(double delta) {
        _infoLabel.Text = $"Material: {_selectedMaterial}\nSteel: {_steel}\nClick nodes to select, then space to build.";

        if (Input.IsActionJustPressed("ui_accept")) { // Space bar to cycle materials
            _selectedMaterial = _selectedMaterial == BeamMaterialId.Wood ? BeamMaterialId.Metal : BeamMaterialId.Wood;
        }

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
            Color nodeColor = node.IsGround ? Colors.Gray : (node.Owner == OwnerId.Player0 ? Colors.Green : Colors.Red);
            if (node.Id == _selectedNodeId) nodeColor = Colors.White;

            DrawCircle(
                new Vector2(node.X * DiceFortresses.Core.Constants.CellSize, node.Y * DiceFortresses.Core.Constants.CellSize),
                6.0f,
                nodeColor
            );
        }
    }
}
