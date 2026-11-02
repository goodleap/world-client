"""Publish one animal GLB/rig/action library with three native skinned LODs."""
import bpy

def export_game(rig, parts, coat, directory, name='wolf', ratios=(.30,.12,.05)):
    for ob in parts:
        colors=ob.data.color_attributes.get('Coat')
        if colors is None:
            colors=ob.data.color_attributes.new(name='Coat',type='FLOAT_COLOR',domain='POINT')
            for p in ob.data.polygons:
                mat=ob.data.materials[p.material_index]
                rgba=mat.node_tree.nodes.get('Principled BSDF').inputs['Base Color'].default_value
                for index in p.vertices:colors.data[index].color=rgba
        ob.data.color_attributes.active_color=colors
        ob.data.materials.clear();ob.data.materials.append(coat)
    bpy.ops.object.select_all(action='DESELECT')
    for ob in parts:ob.select_set(True)
    bpy.context.view_layer.objects.active=parts[0];bpy.ops.object.join();source=parts[0]
    levels=[];report=[]
    for level,ratio in enumerate(ratios):
        ob=source.copy();ob.data=source.data.copy();bpy.context.collection.objects.link(ob)
        ob.name=name.title()+' LOD '+str(level);ob[name+'LOD']=level
        bpy.ops.object.select_all(action='DESELECT');ob.select_set(True);bpy.context.view_layer.objects.active=ob
        mod=ob.modifiers.new('Offline smooth LOD','DECIMATE');mod.ratio=ratio
        # The rig is in bind pose. Apply simplification once, preserving native
        # interpolated vertex colours and skin weights; no runtime remeshing.
        bpy.ops.object.modifier_apply(modifier=mod.name)
        bpy.ops.object.vertex_group_limit_total(limit=4);bpy.ops.object.vertex_group_normalize_all(lock_active=False)
        ob.data.calc_loop_triangles()
        report.append({'level':level,'vertices':len(ob.data.vertices),'triangles':len(ob.data.loop_triangles)})
        levels.append(ob)
    bpy.data.objects.remove(source,do_unlink=True)
    bpy.ops.object.select_all(action='DESELECT');rig.select_set(True)
    for ob in levels:ob.select_set(True)
    bpy.ops.export_scene.gltf(filepath=str(directory/(name+'.glb')),export_format='GLB',use_selection=True,
        export_animations=True,export_animation_mode='NLA_TRACKS',export_force_sampling=True,
        export_materials='EXPORT',export_yup=True,export_extras=True)
    return report
