Rails.application.routes.draw do
  resources :orders, only: [:index, :show]
  get 'health', to: 'health#show'
end
