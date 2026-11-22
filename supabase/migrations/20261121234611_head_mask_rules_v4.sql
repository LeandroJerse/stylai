-- Head margin v4: the head is judged by the person segmentation mask (analyzer a2). A whole head with a
-- small margin is approved (with advice); a real cut asks for another photo; missing evidence = unconfirmed.
-- Approvals by older rules must be revalidated before generating. Stored bytes are kept (nothing deleted):
-- the person re-runs the current rules on the same photo ("Tentar validar de novo").
begin;
create or replace function private.required_pose_rules() returns text
language sql immutable security invoker set search_path = '' as $$ select 'pose-rules/4'::text $$;

update private.assets set state='rejected', validation_status='error',
  validation=coalesce(validation,'{}'::jsonb) || jsonb_build_object('status','error','supports',
    jsonb_build_object('upper',false,'lower',false,'dress',false),
    'issues',jsonb_build_array(jsonb_build_object('code','rules_updated',
      'message','Atualizamos o validador de fotos. Toque em “Validar de novo” para conferir esta foto.')))
where kind='body_photo' and state='ready' and validation_status='approved'
  and split_part(coalesce(validator_version,''),'+',2)<>private.required_pose_rules();
commit;
