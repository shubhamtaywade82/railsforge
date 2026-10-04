# Routine controller action changes

Reference for the `rails-action-controller` skill. Load it on demand when the change is a routine controller action edit. The operating rules, invariants, and verification steps stay in the skill's `SKILL.md`.

## Routine controller action changes

_Merged from the retired `rails-action-controller` skill._

### Repository inspection

Read:

- route declaration
- action and neighboring actions
- authentication/authorization patterns
- service/domain/model collaborators
- serializer/view
- request tests
- error response conventions

### Responsibilities

A controller generally:

1. receives request
2. establishes requester context
3. authorizes according to project convention
4. filters/normalizes boundary input
5. invokes application/domain behavior
6. maps result to HTTP response

Keep substantial business logic outside the action when it does not naturally belong at the HTTP boundary.

### Parameters

Treat incoming values as untrusted.

Use the repository's established strong-parameter or request validation approach.

Do not duplicate every model rule in the controller.

### Response contract

Verify:

- status
- headers where relevant
- render/template/serializer
- redirect destination
- response format
- error shape

A controller refactor must not silently change an API response.

### Error handling

Follow repository conventions for expected domain failures versus unexpected exceptions.

Do not use broad rescue clauses to hide programming errors.

### Action complexity

When an action becomes a workflow involving several concepts, consider a service/application object, but do not extract trivial code merely to shorten the controller.

### Security boundary

Do not assume hidden fields or UI state are trusted. Authorization must be enforced at the server boundary.

### Reference example

A plain CRUD controller: strong parameters, one lookup, explicit status, nothing else.

```ruby
class ProjectsController < ApplicationController
  def index
    @projects = current_user.projects.order(created_at: :desc)
  end

  def create
    @project = current_user.projects.build(project_params)

    if @project.save
      redirect_to @project, notice: t(".created")
    else
      render :new, status: :unprocessable_entity
    end
  end

  private

  def project_params
    params.require(:project).permit(:name, :description)
  end
end
```

### Agent review checklist

- [ ] route/action relationship checked
- [ ] authentication/authorization behavior preserved
- [ ] params boundary explicit
- [ ] business logic owned elsewhere when appropriate
- [ ] response contract preserved
- [ ] expected and unexpected failures distinguished

### Verification

Use request/controller tests that exercise the actual HTTP contract: successful request, invalid input, unauthorized/forbidden behavior, not-found behavior where relevant, and expected response format.

### Book integration: controller filters

Controller callbacks such as before_action are useful for repeatable request prerequisites such as authentication and loading a resource. Keep the callback small and explicit.

Do not move arbitrary business workflows into callbacks. If the operation coordinates several domain steps, keep the callback as a boundary check and delegate the workflow elsewhere.

Always verify which actions are affected by a callback; an authentication filter intended for private actions must not accidentally protect public endpoints.
