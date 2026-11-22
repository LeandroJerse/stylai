-- QA-001 residual: require current head-margin rules; stored images remain available for revalidation.
begin;
create or replace function private.required_pose_rules() returns text
language sql immutable security invoker set search_path = '' as $$ select 'pose-rules/3'::text $$;

update private.assets set state='rejected', validation_status='error',
  validation=coalesce(validation,'{}'::jsonb) || jsonb_build_object('status','error','supports',
    jsonb_build_object('upper',false,'lower',false,'dress',false),
    'issues',jsonb_build_array(jsonb_build_object('code','rules_updated',
      'message','Atualizamos o validador de fotos. Toque em “Tentar validar de novo” para conferir esta foto.')))
where kind='body_photo' and state='ready' and validation_status='approved'
  and split_part(coalesce(validator_version,''),'+',2)<>private.required_pose_rules();

commit;
