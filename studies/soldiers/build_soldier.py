"""Dress an in-memory copy of the base model. Never overwrite base-human/.

blender -b -t 8 --python studies/soldiers/build_soldier.py -- --role infantry
"""
import argparse
from pathlib import Path
import sys
import bpy

ROOT=Path(__file__).resolve().parent
sys.path.insert(0,str(ROOT))
import dressing

parser=argparse.ArgumentParser()
parser.add_argument('--role',choices=['infantry','cavalry'],required=True)
parser.add_argument('--output')
parser.add_argument('--proxy',action='store_true',help='Review mounted bones and full-size hoof proxies first')
args=parser.parse_args(sys.argv[sys.argv.index('--')+1:] if '--' in sys.argv else [])
out=Path(args.output) if args.output else ROOT/args.role
out.mkdir(parents=True,exist_ok=True)
if out.resolve().is_relative_to((ROOT.parent/'base-human').resolve()):
    raise ValueError('The base-human directory is read-only for this builder')
bpy.ops.wm.open_mainfile(filepath=str(ROOT.parent/'base-human/base-human.blend'))
rig=bpy.data.objects['BaseHumanRig']
rig.animation_data.action=bpy.data.actions['Walk']
bpy.context.scene.frame_set(0)
if args.role=='cavalry':
    import mount
    dressing.rig=rig
    mount.add_bones(rig)
    if args.proxy:mount.proxy(rig)
    else:
        import pony
        mats=dressing.uniform(rig)
        dressing.helmet(mats)
        pony.horse(rig,mats)
        pony.rider_equipment(rig,mats)
    mount.actions(rig)
    if not args.proxy:pony.fitted_tack(rig,mats)
else:
    mats=dressing.uniform(rig)
    dressing.helmet(mats)
    dressing.sword_and_shield(mats)
    dressing.held_arm_poses()
dressing.export(out,args.role)
print('EXPORTED',args.role,len(rig.data.bones),[a.name for a in bpy.data.actions])
