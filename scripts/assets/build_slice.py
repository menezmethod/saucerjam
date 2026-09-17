"""Build the Confluence V2 first asset slice in Blender.

Run with Blender's Python, for example:
  blender --background --python scripts/assets/build_slice.py -- --out=/tmp/saucerjam-slice

The script intentionally generates simple, deterministic placeholders. Meshy or
another 3D agent can replace individual GLBs after the same manifest checks pass.
"""
import bpy
import json
import os
import sys
from mathutils import Vector

OUT = os.path.abspath("src/assets/models/slice")
for index, arg in enumerate(sys.argv):
    if arg.startswith("--out="):
        OUT = os.path.abspath(arg.split("=", 1)[1])
    elif arg == "--out" and index + 1 < len(sys.argv):
        OUT = os.path.abspath(sys.argv[index + 1])
os.makedirs(OUT, exist_ok=True)

def to_blender(point):
    """Runtime SaucerJam (X,Y,Z) -> Blender authoring (X,Y,Z)."""
    x, y, z = point
    return (x, -z, y)

def material(name, color, emission=0.0):
    mat = bpy.data.materials.new(name)
    mat.diffuse_color = (*color, 1)
    mat.use_nodes = True
    node = mat.node_tree.nodes.get("Principled BSDF")
    node.inputs["Base Color"].default_value = (*color, 1)
    node.inputs["Roughness"].default_value = 0.38
    if emission:
        node.inputs["Emission Color"].default_value = (*color, 1)
        node.inputs["Emission Strength"].default_value = emission
    return mat

GRAPHITE = material("Graphite", (0.055, 0.075, 0.09))
CYAN = material("Cyan_Emissive", (0.02, 0.65, 0.9), 4.0)
GREEN = material("Bloom_Emissive", (0.05, 0.9, 0.35), 5.0)
AMBER = material("Amber_Accent", (0.95, 0.35, 0.06), 2.0)

def fresh_collection(name):
    old = bpy.data.collections.get(name)
    if old:
        bpy.data.collections.remove(old)
    col = bpy.data.collections.new(name)
    bpy.context.scene.collection.children.link(col)
    return col

def move_to(obj, col):
    for parent in list(obj.users_collection):
        parent.objects.unlink(obj)
    col.objects.link(obj)

def cube(name, dimensions, runtime_center, mat, col, bevel=0.0):
    bpy.ops.mesh.primitive_cube_add(size=1, location=to_blender(runtime_center))
    obj = bpy.context.object
    obj.name = name
    obj.dimensions = (dimensions[0], dimensions[2], dimensions[1])
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    obj.data.materials.append(mat)
    move_to(obj, col)
    if bevel:
        mod = obj.modifiers.new("soft_edges", "BEVEL")
        mod.width = bevel
        mod.segments = 1
        bpy.context.view_layer.objects.active = obj
        bpy.ops.object.modifier_apply(modifier=mod.name)
    return obj

def cylinder(name, radius, height, runtime_center, mat, col, vertices=12):
    bpy.ops.mesh.primitive_cylinder_add(vertices=vertices, radius=radius, depth=height, location=to_blender(runtime_center))
    obj = bpy.context.object
    obj.name = name
    obj.data.materials.append(mat)
    move_to(obj, col)
    return obj

def empty(name, runtime_point, col):
    obj = bpy.data.objects.new(name, None)
    obj.empty_display_type = "PLAIN_AXES"
    obj.empty_display_size = 0.18
    obj.location = to_blender(runtime_point)
    col.objects.link(obj)
    return obj

def sockets(col):
    for name, point in {"N": (0, 0, -4), "E": (4, 0, 0), "S": (0, 0, 4), "W": (-4, 0, 0)}.items():
        empty("SOCKET_" + name, point, col)

def export_collection(col, filename):
    bpy.ops.object.select_all(action="DESELECT")
    for obj in col.objects:
        obj.select_set(True)
    bpy.context.view_layer.objects.active = next((o for o in col.objects if o.type == "MESH"), None)
    bpy.ops.export_scene.gltf(filepath=os.path.join(OUT, filename), export_format="GLB", use_selection=True)

def build_tile(asset_id, build):
    col = fresh_collection("SLICE_" + asset_id)
    build(col)
    export_collection(col, asset_id + ".glb")
    return col

def deck(col):
    cube("Deck", (8, 0.2, 8), (0, 0.1, 0), GRAPHITE, col, 0.04)
    sockets(col)

def straight(col):
    cube("Wall", (8, 3.5, 1.2), (0, 1.75, 0), GRAPHITE, col, 0.05)
    cube("Conduit", (6.8, 0.06, 0.04), (0, 2.25, -0.63), CYAN, col)
    sockets(col)

def corner(col):
    cube("Wall_N", (1.2, 3.5, 4.6), (0, 1.75, -1.7), GRAPHITE, col, 0.05)
    cube("Wall_E", (3.4, 3.5, 1.2), (2.3, 1.75, 0), GRAPHITE, col, 0.05)
    sockets(col)

def bloom(col):
    cylinder("Bloom_Base", 1.45, 0.45, (0, 0.225, 0), GRAPHITE, col)
    cylinder("Bloom_Coil", 0.78, 0.12, (0, 0.52, 0), GREEN, col)

def portal(col):
    # Two uprights and a top beam leave a clear 2.8m opening.
    cube("Portal_Left", (0.42, 3.8, 0.42), (-1.9, 1.9, 0), GRAPHITE, col, 0.06)
    cube("Portal_Right", (0.42, 3.8, 0.42), (1.9, 1.9, 0), GRAPHITE, col, 0.06)
    cube("Portal_Top", (4.2, 0.42, 0.42), (0, 3.8, 0), CYAN, col, 0.06)

def ship_01(col):
    # Compact runtime +Z nose wedge. Blender conversion is applied per vertex.
    verts = [
        (-0.64, 0.00, -0.52), (0.64, 0.00, -0.52),
        (-0.52, 0.18, 0.22), (0.52, 0.18, 0.22),
        (0.00, 0.10, 0.78), (0.00, -0.16, -0.38),
    ]
    faces = [(0, 1, 3, 2), (0, 2, 4), (1, 4, 3), (0, 5, 1), (2, 3, 4), (0, 1, 5)]
    mesh = bpy.data.meshes.new("VectorHullMesh")
    mesh.from_pydata([to_blender(v) for v in verts], [], faces)
    mesh.materials.append(GRAPHITE)
    hull = bpy.data.objects.new("Hull", mesh)
    col.objects.link(hull)
    empty("mount_primary", (0, 0, 0.78), col)
    empty("mount_thruster_left", (-0.32, -0.02, -0.59), col)
    empty("mount_thruster_right", (0.32, -0.02, -0.59), col)

build_tile("floor_deck_standard", deck)
build_tile("wall_straight_barrier", straight)
build_tile("wall_corner_90", corner)
build_tile("prop_reactor_bloom", bloom)
build_tile("prop_quantum_portal", portal)
build_tile("ship_01_vector", ship_01)

manifest = {
    "version": "1.0.0",
    "gridMeters": 8,
    "assets": {
        "floor_deck_standard": {"model": "floor_deck_standard.glb", "collision": None, "trianglesMax": 500},
        "wall_straight_barrier": {"model": "wall_straight_barrier.glb", "collision": {"type": "box", "w": 8, "d": 1.2}, "trianglesMax": 1200},
        "wall_corner_90": {"model": "wall_corner_90.glb", "collision": {"type": "elbow"}, "trianglesMax": 1500},
        "prop_reactor_bloom": {"model": "prop_reactor_bloom.glb", "trigger": {"type": "bloom", "radius": 1.6}, "trianglesMax": 1200},
        "prop_quantum_portal": {"model": "prop_quantum_portal.glb", "trigger": {"type": "portal", "radius": 1.2}, "trianglesMax": 1500},
        "ship_01_vector": {"model": "ship_01_vector.glb", "collision": {"type": "circle", "radius": 0.8}, "trianglesMax": 2500},
    },
}
with open(os.path.join(OUT, "slice-manifest.json"), "w", encoding="utf-8") as handle:
    json.dump(manifest, handle, indent=2)
bpy.ops.wm.save_as_mainfile(filepath=os.path.join(OUT, "slice.blend"))
print("Confluence V2 slice written to", OUT)
